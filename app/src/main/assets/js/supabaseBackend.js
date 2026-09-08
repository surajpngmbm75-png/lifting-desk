/**
 * MPF LiftDesk - Supabase Cloud Backend Integration
 * Provides cloud database synchronization, offline-first persistence,
 * real-time sync subscriptions, and automatic schema verification.
 */

(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    url: 'https://tkbjsvrhysfadcczluzj.supabase.co',
    anonKey: 'sb_publishable_l_Tt8s_Cb-gOr1x_4wsyLA_1_RRrvxJ',
    legacyAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrYmpzdnJoeXNmYWRjY3psdXpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDE3MjcsImV4cCI6MjEwNDM3NzcyN30.ZtzGjjX2U8Qm6YaUuE9nl1WjWv3QdcViu0LcyFhkNws',
    publishableKey: 'sb_publishable_l_Tt8s_Cb-gOr1x_4wsyLA_1_RRrvxJ',
    projectRef: 'tkbjsvrhysfadcczluzj',
    autoSyncIntervalMinutes: 5,
    autoSyncEnabled: true
  };

  const SYNC_TABLES = [
    'farmers',
    'stores',
    'liftings',
    'cages',
    'sales',
    'payments',
    'singke_settlements',
    'settings'
  ];

  class SupabaseBackendService {
    constructor() {
      this.config = this.loadConfig();
      this.client = null;
      this.status = 'INITIALIZING'; // INITIALIZING | ONLINE | SCHEMA_PENDING | OFFLINE | SYNCING | ERROR
      this.statusMessage = 'Connecting to Supabase Cloud...';
      this.lastSyncTime = localStorage.getItem('supabase_last_sync') || null;
      this.syncQueue = this.loadQueue();
      this.listeners = [];
      this.realtimeChannel = null;
      this.isSyncing = false;

      this.initClient();
    }

    loadConfig() {
      try {
        const saved = localStorage.getItem('supabase_custom_config');
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...DEFAULT_CONFIG, ...parsed };
        }
      } catch (e) {
        console.warn('Failed to parse saved Supabase config:', e);
      }
      return { ...DEFAULT_CONFIG };
    }

    saveConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
      localStorage.setItem('supabase_custom_config', JSON.stringify(this.config));
      this.initClient();
      this.checkConnection();
    }

    resetDefaultConfig() {
      localStorage.removeItem('supabase_custom_config');
      this.config = { ...DEFAULT_CONFIG };
      this.initClient();
      this.checkConnection();
    }

    loadQueue() {
      try {
        const q = localStorage.getItem('supabase_sync_queue');
        return q ? JSON.parse(q) : [];
      } catch (e) {
        return [];
      }
    }

    saveQueue() {
      try {
        localStorage.setItem('supabase_sync_queue', JSON.stringify(this.syncQueue));
      } catch (e) {
        console.warn('Failed to save sync queue:', e);
      }
    }

    onStatusChange(callback) {
      this.listeners.push(callback);
      callback(this.status, this.statusMessage, this);
      return () => {
        this.listeners = this.listeners.filter(cb => cb !== callback);
      };
    }

    notifyStatus(status, message) {
      this.status = status;
      if (message) this.statusMessage = message;
      console.log(`[Supabase Status] ${this.status}: ${this.statusMessage}`);
      this.listeners.forEach(cb => {
        try { cb(this.status, this.statusMessage, this); } catch (e) { console.error(e); }
      });
      this.updateHeaderBadge();
    }

    initClient() {
      try {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
          this.client = window.supabase.createClient(this.config.url, this.config.anonKey, {
            auth: {
              persistSession: true,
              autoRefreshToken: true
            },
            realtime: {
              params: {
                eventsPerSecond: 10
              }
            }
          });
          console.log('Supabase JS Client initialized successfully.');
        } else {
          console.warn('window.supabase SDK not found, fallback REST mode active.');
          this.client = null;
        }
      } catch (e) {
        console.error('Error creating Supabase client:', e);
        this.client = null;
      }
    }

    /**
     * Test connection and verify if database tables exist.
     */
    async checkConnection() {
      if (!navigator.onLine) {
        this.notifyStatus('OFFLINE', 'Device is offline. Local changes will sync when connected.');
        return { ok: false, status: 'OFFLINE' };
      }

      try {
        const checkUrl = `${this.config.url}/rest/v1/farmers?select=id&limit=1`;
        const resp = await fetch(checkUrl, {
          method: 'GET',
          headers: {
            'apikey': this.config.anonKey,
            'Authorization': `Bearer ${this.config.anonKey}`,
            'Range': '0-0'
          }
        });

        if (resp.status === 200 || resp.status === 206) {
          this.notifyStatus('ONLINE', 'Connected to Supabase Cloud. Backend is fully operational.');
          this.initRealtimeSubscriptions();
          // Process queued items if any
          if (this.syncQueue.length > 0) {
            this.processQueue();
          }
          return { ok: true, status: 'ONLINE' };
        } else if (resp.status === 404) {
          const errData = await resp.json().catch(() => ({}));
          if (errData && errData.code === 'PGRST205') {
            this.notifyStatus('SCHEMA_PENDING', 'Supabase connected, but tables need to be created. Click to setup SQL.');
            return { ok: false, status: 'SCHEMA_PENDING', hint: 'Run the setup SQL in Supabase SQL editor' };
          }
        } else if (resp.status === 401 || resp.status === 403) {
          this.notifyStatus('ERROR', `Authentication error (${resp.status}): Check anon API key.`);
          return { ok: false, status: 'ERROR' };
        }

        this.notifyStatus('OFFLINE', `Server responded with status ${resp.status}`);
        return { ok: false, status: 'OFFLINE' };
      } catch (e) {
        console.warn('Supabase connection check failed:', e);
        this.notifyStatus('OFFLINE', 'Unable to reach Supabase server. Working in offline mode.');
        return { ok: false, status: 'OFFLINE', error: e.message };
      }
    }

    /**
     * Direct REST query helper
     */
    async rest(endpoint, options = {}) {
      const url = `${this.config.url}/rest/v1/${endpoint}`;
      const headers = {
        'apikey': this.config.anonKey,
        'Authorization': `Bearer ${this.config.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        ...(options.headers || {})
      };

      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        let errBody = null;
        try { errBody = await response.json(); } catch (e) {}
        const error = new Error((errBody && (errBody.message || errBody.hint)) || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = errBody && errBody.code;
        throw error;
      }

      if (options.method === 'HEAD' || response.status === 204) return null;
      try {
        return await response.json();
      } catch (e) {
        return null;
      }
    }

    /**
     * Queues or executes an immediate single-record mutation to Supabase
     */
    async pushChange(tableName, action, recordOrId) {
      // Add to queue
      this.syncQueue.push({
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        table: tableName,
        action: action, // 'UPSERT' or 'DELETE'
        data: recordOrId,
        timestamp: new Date().toISOString()
      });
      this.saveQueue();

      // If online and not schema pending, attempt immediate flush
      if (this.status === 'ONLINE') {
        this.processQueue().catch(e => console.warn('Queue flush notice:', e));
      }
    }

    async processQueue() {
      if (this.syncQueue.length === 0 || this.status !== 'ONLINE') return;
      const items = [...this.syncQueue];
      console.log(`Processing ${items.length} pending Supabase changes...`);

      const failed = [];
      for (const item of items) {
        try {
          if (item.action === 'UPSERT') {
            await this.upsertSingle(item.table, item.data);
          } else if (item.action === 'DELETE') {
            await this.deleteSingle(item.table, item.data);
          }
        } catch (e) {
          console.warn(`Failed to sync queued item for ${item.table}:`, e);
          if (e.code === 'PGRST205') {
            this.notifyStatus('SCHEMA_PENDING', 'Tables need to be created in Supabase SQL editor.');
            return;
          }
          failed.push(item);
        }
      }

      this.syncQueue = failed;
      this.saveQueue();
    }

    /**
     * Map a local IndexedDB record to match the Supabase PostgreSQL table schema
     */
    transformToCloud(table, local) {
      if (!local || typeof local !== 'object') return local;
      const now = new Date().toISOString();

      switch (table) {
        case 'farmers':
          return {
            id: String(local.id),
            name: String(local.name || '').trim(),
            phone: String(local.phone || '').trim(),
            village: local.farmLocation || local.village || null,
            capacity: local.capacity !== undefined ? parseInt(local.capacity) || null : null,
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || now
          };

        case 'stores':
          return {
            id: String(local.id),
            name: String(local.name || '').trim(),
            contact_person: local.contactPerson || null,
            phone: String(local.phone || '').trim(),
            address: local.address || null,
            is_wangkhei: !!(local.isWangkhei || local.singkeAccount === 'Singke' || (local.name && local.name.toLowerCase().includes('wangkhei'))),
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || now
          };

        case 'liftings':
          return {
            id: String(local.id),
            lifting_date: local.liftingDate || (local.createdAt ? local.createdAt.slice(0, 10) : now.slice(0, 10)),
            farmer_id: String(local.farmerId),
            farmer_name: local.farmerName || null,
            vehicle_number: local.vehicleNumber || null,
            driver_name: local.driverName || null,
            rate_per_kg: Number(local.ratePerKg) || 0,
            total_birds: parseInt(local.totalBirds) || 0,
            total_weight: parseFloat(local.totalWeight) || 0,
            total_amount: parseFloat(local.totalAmount) || 0,
            singke_payable_amount: parseFloat(local.singkePayableAmount) || parseFloat(local.totalAmount) || 0,
            wangkhei_deductions_applied: parseFloat(local.wangkheiDeductions) || 0,
            remarks: local.remarks || null,
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || now
          };

        case 'cages':
          return {
            id: String(local.id),
            lifting_id: String(local.liftingId),
            serial_number: local.cageNumber !== undefined ? String(local.cageNumber) : null,
            gross_weight: parseFloat(local.grossWeight) || 0,
            tare_weight: parseFloat(local.emptyWeight !== undefined ? local.emptyWeight : (local.tareWeight || 0)) || 0,
            net_weight: parseFloat(local.netWeight) || 0,
            birds_count: parseInt(local.birdsCount) || 0,
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || local.createdAt || now
          };

        case 'sales':
          return {
            id: String(local.id),
            sale_date: local.saleDate || (local.createdAt ? local.createdAt.slice(0, 10) : now.slice(0, 10)),
            store_id: String(local.storeId),
            store_name: local.storeName || null,
            is_wangkhei_store: !!(local.isWangkheiSale || (local.storeName && local.storeName.toLowerCase().includes('wangkhei'))),
            lifting_id: local.liftingId ? String(local.liftingId) : null,
            farmer_id: local.farmerId ? String(local.farmerId) : null,
            farmer_name: local.farmerName || null,
            total_birds: parseInt(local.birdsCount !== undefined ? local.birdsCount : (local.totalBirds || 0)) || 0,
            total_weight: parseFloat(local.netWeight !== undefined ? local.netWeight : (local.totalWeight || 0)) || 0,
            rate_per_kg: parseFloat(local.ratePerKg) || 0,
            total_amount: parseFloat(local.saleAmount !== undefined ? local.saleAmount : (local.totalAmount || 0)) || 0,
            remarks: local.remarks || null,
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || now
          };

        case 'payments':
          return {
            id: String(local.id),
            payment_date: local.paymentDate || (local.createdAt ? local.createdAt.slice(0, 10) : now.slice(0, 10)),
            store_id: String(local.storeId),
            store_name: local.storeName || null,
            amount: parseFloat(local.amount) || 0,
            payment_mode: (local.paymentMode || 'CASH').toUpperCase(),
            reference_number: local.referenceNumber || null,
            remarks: local.remarks || null,
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || local.createdAt || now
          };

        case 'singke_settlements':
          return {
            id: String(local.id),
            settlement_date: local.date || (local.createdAt ? local.createdAt.slice(0, 10) : now.slice(0, 10)),
            amount: parseFloat(local.amount) || 0,
            payment_mode: (local.paymentMethod || 'CASH').toUpperCase(),
            reference_no: local.referenceNumber || local.refNumber || null,
            notes: local.remarks || local.notes || null,
            created_at: local.createdAt || now,
            updated_at: local.updatedAt || now
          };

        case 'settings':
          return {
            key: String(local.key),
            value: typeof local.value === 'object' && local.value !== null ? local.value : { val: local.value },
            updated_at: local.updatedAt || now
          };

        default:
          return local;
      }
    }

    /**
     * Map a Supabase PostgreSQL row back to match IndexedDB expectations
     */
    transformFromCloud(table, row) {
      if (!row || typeof row !== 'object') return row;
      const now = new Date().toISOString();

      switch (table) {
        case 'farmers':
          return {
            id: row.id,
            name: row.name,
            phone: row.phone,
            farmLocation: row.village || '',
            village: row.village || '',
            active: true,
            capacity: row.capacity || null,
            liftingRate: 0,
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'stores':
          return {
            id: row.id,
            name: row.name,
            contactPerson: row.contact_person || '',
            phone: row.phone,
            address: row.address || '',
            openingDue: 0,
            isWangkhei: !!row.is_wangkhei,
            singkeAccount: row.is_wangkhei ? 'Singke' : 'General',
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'liftings':
          return {
            id: row.id,
            liftingDate: row.lifting_date,
            farmerId: row.farmer_id,
            farmerName: row.farmer_name || '',
            vehicleNumber: row.vehicle_number || '',
            driverName: row.driver_name || '',
            ratePerKg: Number(row.rate_per_kg) || 0,
            totalBirds: parseInt(row.total_birds) || 0,
            totalWeight: parseFloat(row.total_weight) || 0,
            totalGrossWeight: parseFloat(row.total_weight) || 0,
            totalTareWeight: 0,
            totalCages: 0,
            totalAmount: parseFloat(row.total_amount) || 0,
            singkePayableAmount: parseFloat(row.singke_payable_amount) || parseFloat(row.total_amount) || 0,
            wangkheiDeductions: parseFloat(row.wangkhei_deductions_applied) || 0,
            remarks: row.remarks || '',
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'cages':
          return {
            id: row.id,
            liftingId: row.lifting_id,
            cageNumber: row.serial_number ? parseInt(row.serial_number) || 1 : 1,
            grossWeight: parseFloat(row.gross_weight) || 0,
            emptyWeight: parseFloat(row.tare_weight) || 0,
            tareWeight: parseFloat(row.tare_weight) || 0,
            netWeight: parseFloat(row.net_weight) || 0,
            birdsCount: parseInt(row.birds_count) || 0,
            isSold: false,
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'sales':
          return {
            id: row.id,
            saleDate: row.sale_date,
            storeId: row.store_id,
            storeName: row.store_name || '',
            isWangkheiSale: !!row.is_wangkhei_store,
            liftingId: row.lifting_id || null,
            farmerId: row.farmer_id || null,
            farmerName: row.farmer_name || '',
            birdsCount: parseInt(row.total_birds) || 0,
            netWeight: parseFloat(row.total_weight) || 0,
            ratePerKg: parseFloat(row.rate_per_kg) || 0,
            saleAmount: parseFloat(row.total_amount) || 0,
            paidAmount: parseFloat(row.total_amount) || 0,
            previousDue: 0,
            outstanding: 0,
            remarks: row.remarks || '',
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'payments':
          return {
            id: row.id,
            storeId: row.store_id,
            storeName: row.store_name || '',
            paymentDate: row.payment_date,
            amount: parseFloat(row.amount) || 0,
            paymentMode: row.payment_mode || 'Cash',
            referenceNumber: row.reference_number || '',
            remarks: row.remarks || '',
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'singke_settlements':
          return {
            id: row.id,
            date: row.settlement_date,
            amount: parseFloat(row.amount) || 0,
            paymentMethod: row.payment_mode || 'Cash',
            referenceNumber: row.reference_no || '',
            refNumber: row.reference_no || '',
            remarks: row.notes || '',
            notes: row.notes || '',
            type: 'SETTLEMENT',
            createdAt: row.created_at || now,
            updatedAt: row.updated_at || now
          };

        case 'settings':
          return {
            key: row.key,
            value: row.value,
            updatedAt: row.updated_at || now
          };

        default:
          return row;
      }
    }

    async upsertSingle(table, record) {
      const cloudRecord = this.transformToCloud(table, record);
      const onConflictKey = table === 'settings' ? 'key' : 'id';
      if (this.client) {
        const { error } = await this.client.from(table).upsert(cloudRecord, { onConflict: onConflictKey });
        if (error) throw error;
        return;
      }

      // REST fallback
      await this.rest(table, {
        method: 'POST',
        headers: {
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(cloudRecord)
      });
    }

    async deleteSingle(table, id) {
      const keyCol = table === 'settings' ? 'key' : 'id';
      if (this.client) {
        const { error } = await this.client.from(table).delete().eq(keyCol, id);
        if (error) throw error;
        return;
      }

      // REST fallback
      await this.rest(`${table}?${keyCol}=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
    }

    /**
     * Upload all local IndexedDB data to Supabase
     */
    async uploadAllLocalData() {
      if (!window.liftDeskDB) throw new Error('Local database not ready.');
      this.notifyStatus('SYNCING', 'Uploading local records to Supabase Cloud...');

      const localData = await window.liftDeskDB.exportDatabaseToJson();
      const results = {};

      for (const table of SYNC_TABLES) {
        const rawRecords = localData[table] || [];
        if (rawRecords.length === 0) {
          results[table] = 0;
          continue;
        }

        const records = rawRecords.map(r => this.transformToCloud(table, r));
        const onConflictKey = table === 'settings' ? 'key' : 'id';

        try {
          if (this.client) {
            // Upsert in batches of 200
            const batchSize = 200;
            for (let i = 0; i < records.length; i += batchSize) {
              const batch = records.slice(i, i + batchSize);
              const { error } = await this.client.from(table).upsert(batch, { onConflict: onConflictKey });
              if (error) throw error;
            }
          } else {
            // REST batch upsert
            await this.rest(table, {
              method: 'POST',
              headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify(records)
            });
          }
          results[table] = records.length;
        } catch (e) {
          console.error(`Error uploading ${table}:`, e);
          if (e.code === 'PGRST205') {
            this.notifyStatus('SCHEMA_PENDING', 'Tables need to be created in Supabase SQL editor.');
            throw new Error(`Table 'public.${table}' does not exist in Supabase yet. Please run the setup SQL script.`);
          }
          throw e;
        }
      }

      this.lastSyncTime = new Date().toISOString();
      localStorage.setItem('supabase_last_sync', this.lastSyncTime);
      this.notifyStatus('ONLINE', `Successfully uploaded local data to Supabase.`);
      return results;
    }

    /**
     * Download all cloud data from Supabase into local IndexedDB
     */
    async downloadAllCloudData() {
      if (!window.liftDeskDB) throw new Error('Local database not ready.');
      this.notifyStatus('SYNCING', 'Downloading latest data from Supabase Cloud...');

      const cloudData = {};
      for (const table of SYNC_TABLES) {
        try {
          let rows = [];
          if (this.client) {
            const { data, error } = await this.client.from(table).select('*');
            if (error) throw error;
            rows = data || [];
          } else {
            rows = await this.rest(`${table}?select=*`, { method: 'GET' }) || [];
          }
          cloudData[table] = rows.map(r => this.transformFromCloud(table, r));
        } catch (e) {
          console.error(`Error downloading ${table}:`, e);
          if (e.code === 'PGRST205') {
            this.notifyStatus('SCHEMA_PENDING', 'Tables need to be created in Supabase SQL editor.');
            throw new Error(`Table 'public.${table}' does not exist in Supabase yet.`);
          }
          throw e;
        }
      }

      // Merge into local IndexedDB
      await window.liftDeskDB.importDatabaseFromJson(cloudData, { merge: true });

      this.lastSyncTime = new Date().toISOString();
      localStorage.setItem('supabase_last_sync', this.lastSyncTime);
      this.notifyStatus('ONLINE', 'Local database updated with Supabase Cloud data.');
      return cloudData;
    }

    /**
     * Full two-way synchronization
     */
    async syncAll() {
      if (this.isSyncing) return;
      this.isSyncing = true;

      try {
        const conn = await this.checkConnection();
        if (!conn.ok) {
          if (conn.status === 'SCHEMA_PENDING') {
            throw new Error('Supabase tables have not been created yet. Please copy and run the SQL setup script.');
          }
          throw new Error(`Supabase is currently ${conn.status}`);
        }

        this.notifyStatus('SYNCING', 'Synchronizing with Supabase Cloud...');

        // 1. Process local mutations in queue
        await this.processQueue();

        // 2. Upload any local records missing from cloud
        await this.uploadAllLocalData();

        // 3. Download cloud records and merge locally
        await this.downloadAllCloudData();

        this.notifyStatus('ONLINE', `Cloud sync complete at ${new Date().toLocaleTimeString()}`);
        return { success: true, timestamp: this.lastSyncTime };
      } catch (e) {
        console.error('Supabase sync error:', e);
        if (this.status !== 'SCHEMA_PENDING') {
          this.notifyStatus('ERROR', e.message);
        }
        throw e;
      } finally {
        this.isSyncing = false;
      }
    }

    /**
     * Listen to real-time changes across tables
     */
    initRealtimeSubscriptions() {
      if (!this.client || this.realtimeChannel) return;

      try {
        this.realtimeChannel = this.client.channel('mpf_liftdeck_realtime');
        SYNC_TABLES.forEach(tableName => {
          this.realtimeChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tableName },
            (payload) => {
              console.log(`[Supabase Realtime] Event on ${tableName}:`, payload.eventType);
              this.handleRealtimeEvent(tableName, payload);
            }
          );
        });

        this.realtimeChannel.subscribe((status) => {
          console.log('[Supabase Realtime Status]:', status);
        });
      } catch (e) {
        console.warn('Failed to subscribe to realtime channel:', e);
      }
    }

    async handleRealtimeEvent(tableName, payload) {
      if (!window.liftDeskDB) return;
      try {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        const db = window.liftDeskDB;

        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          if (newRecord) {
            // Update local IndexedDB with mapped fields
            const localRecord = this.transformFromCloud(tableName, newRecord);
            await db.rawUpsert(tableName, localRecord);
          }
        } else if (eventType === 'DELETE') {
          if (oldRecord && oldRecord.id) {
            await db.rawDelete(tableName, oldRecord.id);
          }
        }

        // Notify UI to refresh if currently viewing relevant section
        if (window.refreshCurrentActiveView) {
          window.refreshCurrentActiveView();
        }
      } catch (e) {
        console.warn('Realtime event apply error:', e);
      }
    }

    updateHeaderBadge() {
      const badge = document.getElementById('headerCloudSyncBadge');
      if (!badge) return;

      if (this.status === 'ONLINE') {
        badge.className = 'badge badge-success';
        badge.innerHTML = '☁️ Synced';
        badge.style.background = '#ECFDF5';
        badge.style.color = '#047857';
        badge.style.borderColor = '#A7F3D0';
        badge.title = `Supabase Connected (${this.config.projectRef}). Last synced: ${this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleTimeString() : 'Just now'}`;
      } else if (this.status === 'SYNCING') {
        badge.className = 'badge badge-warning';
        badge.innerHTML = '🔄 Syncing...';
        badge.style.background = '#FEF3C7';
        badge.style.color = '#B45309';
        badge.style.borderColor = '#FDE68A';
        badge.title = 'Syncing data with Supabase Cloud...';
      } else if (this.status === 'SCHEMA_PENDING') {
        badge.className = 'badge badge-warning';
        badge.innerHTML = '⚡ Setup SQL';
        badge.style.background = '#EFF6FF';
        badge.style.color = '#1D4ED8';
        badge.style.borderColor = '#BFDBFE';
        badge.title = 'Supabase connected! Click to view & copy SQL table setup script.';
      } else if (this.status === 'OFFLINE') {
        badge.className = 'badge badge-secondary';
        badge.innerHTML = '☁️ Offline';
        badge.style.background = '#F1F5F9';
        badge.style.color = '#64748B';
        badge.style.borderColor = '#CBD5E1';
        badge.title = 'Offline mode. Changes will sync when online.';
      } else {
        badge.className = 'badge badge-danger';
        badge.innerHTML = '☁️ Disconnected';
        badge.style.background = '#FEF2F2';
        badge.style.color = '#DC2626';
        badge.style.borderColor = '#FECACA';
        badge.title = this.statusMessage;
      }
    }

    /**
     * Returns the complete, ready-to-run PostgreSQL DDL script for Supabase
     */
    getSqlSetupScript() {
      return `-- ====================================================================
-- MPF LiftDesk - Supabase Cloud Database Architecture
-- Project: ${this.config.projectRef}
-- Run this script in the Supabase Dashboard: SQL Editor -> New Query -> Run
-- ====================================================================

-- 1. FARMERS MASTER
CREATE TABLE IF NOT EXISTS public.farmers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    "totalLiftings" NUMERIC DEFAULT 0,
    "totalWeight" NUMERIC DEFAULT 0,
    "totalBirds" INTEGER DEFAULT 0,
    "totalAmount" NUMERIC DEFAULT 0,
    "totalPaid" NUMERIC DEFAULT 0,
    "currentBalance" NUMERIC DEFAULT 0,
    "createdAt" TEXT,
    "updatedAt" TEXT
);

-- 2. LIFTINGS
CREATE TABLE IF NOT EXISTS public.liftings (
    id TEXT PRIMARY KEY,
    "liftingDate" TEXT NOT NULL,
    "farmerId" TEXT,
    "farmerName" TEXT,
    "liftingRate" NUMERIC DEFAULT 0,
    "totalCages" INTEGER DEFAULT 0,
    "totalBirds" INTEGER DEFAULT 0,
    "totalWeight" NUMERIC DEFAULT 0,
    "totalGrossWeight" NUMERIC DEFAULT 0,
    "totalTareWeight" NUMERIC DEFAULT 0,
    "totalAmount" NUMERIC DEFAULT 0,
    remarks TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT
);

-- 3. CAGES
CREATE TABLE IF NOT EXISTS public.cages (
    id TEXT PRIMARY KEY,
    "liftingId" TEXT,
    "farmerId" TEXT,
    "cageNumber" INTEGER,
    "grossWeight" NUMERIC DEFAULT 0,
    "emptyWeight" NUMERIC DEFAULT 0,
    "netWeight" NUMERIC DEFAULT 0,
    "birdsCount" INTEGER DEFAULT 0,
    "isSold" BOOLEAN DEFAULT FALSE,
    "soldToStoreId" TEXT,
    "saleId" TEXT,
    "createdAt" TEXT
);

-- 4. STORES MASTER
CREATE TABLE IF NOT EXISTS public.stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    "openingDue" NUMERIC DEFAULT 0,
    "isSystemWangkhei" BOOLEAN DEFAULT FALSE,
    "createdAt" TEXT,
    "updatedAt" TEXT
);

-- 5. SALES INVOICES
CREATE TABLE IF NOT EXISTS public.sales (
    id TEXT PRIMARY KEY,
    "invoiceNumber" TEXT,
    "saleDate" TEXT NOT NULL,
    "storeId" TEXT,
    "storeName" TEXT,
    "cageId" TEXT,
    "liftingId" TEXT,
    "birdsCount" INTEGER DEFAULT 0,
    "netWeight" NUMERIC DEFAULT 0,
    "ratePerKg" NUMERIC DEFAULT 0,
    "saleAmount" NUMERIC DEFAULT 0,
    "paidAmount" NUMERIC DEFAULT 0,
    "previousDue" NUMERIC DEFAULT 0,
    outstanding NUMERIC DEFAULT 0,
    "isWangkheiSale" BOOLEAN DEFAULT FALSE,
    remarks TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT
);

-- 6. STORE PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY,
    "storeId" TEXT,
    "paymentDate" TEXT NOT NULL,
    amount NUMERIC DEFAULT 0,
    "paymentMode" TEXT DEFAULT 'Cash',
    "referenceNumber" TEXT,
    remarks TEXT,
    "createdAt" TEXT
);

-- 7. SINGKE SETTLEMENTS
CREATE TABLE IF NOT EXISTS public.singke_settlements (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    amount NUMERIC DEFAULT 0,
    "paymentMethod" TEXT DEFAULT 'Cash',
    "referenceNumber" TEXT,
    "refNumber" TEXT,
    "farmerId" TEXT,
    remarks TEXT,
    type TEXT DEFAULT 'SETTLEMENT',
    "createdAt" TEXT,
    "updatedAt" TEXT
);

-- 8. SETTINGS & APP STATE
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value JSONB,
    "updatedAt" TEXT
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liftings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.singke_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Anonymous Access Policies for MPF LiftDesk
DROP POLICY IF EXISTS "Allow anon all on farmers" ON public.farmers;
CREATE POLICY "Allow anon all on farmers" ON public.farmers FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on liftings" ON public.liftings;
CREATE POLICY "Allow anon all on liftings" ON public.liftings FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on cages" ON public.cages;
CREATE POLICY "Allow anon all on cages" ON public.cages FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on stores" ON public.stores;
CREATE POLICY "Allow anon all on stores" ON public.stores FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on sales" ON public.sales;
CREATE POLICY "Allow anon all on sales" ON public.sales FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on payments" ON public.payments;
CREATE POLICY "Allow anon all on payments" ON public.payments FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on singke_settlements" ON public.singke_settlements;
CREATE POLICY "Allow anon all on singke_settlements" ON public.singke_settlements FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on settings" ON public.settings;
CREATE POLICY "Allow anon all on settings" ON public.settings FOR ALL TO anon USING (true) WITH CHECK (true);

-- Enable Realtime Sync
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.farmers, public.liftings, public.cages, public.stores, public.sales, public.payments, public.singke_settlements, public.settings;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
`;
    }
  }

  // Instantiate singleton service
  window.supabaseBackend = new SupabaseBackendService();

  // Auto-check connection when page loads
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      window.supabaseBackend.checkConnection();
    }, 500);
  });

  // Re-check when window comes online
  window.addEventListener('online', () => {
    console.log('App came online, checking Supabase connection...');
    window.supabaseBackend.checkConnection().then(res => {
      if (res.ok) {
        window.supabaseBackend.processQueue();
      }
    });
  });

  window.addEventListener('offline', () => {
    window.supabaseBackend.notifyStatus('OFFLINE', 'Device is offline.');
  });

})();
