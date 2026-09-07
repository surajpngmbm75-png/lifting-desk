/**
 * MPF LiftDesk - IndexedDB Database Architecture
 * Optimized for high performance even with 100,000+ farmers.
 * Authoritative single source of truth for Farmer Master.
 */

const DB_NAME = 'MPFLiftDeskDB';
const DB_VERSION = 3;

class LiftDeskDatabase {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Farmers Store (Central Farmer Master)
        if (!db.objectStoreNames.contains('farmers')) {
          const farmerStore = db.createObjectStore('farmers', { keyPath: 'id' });
          farmerStore.createIndex('by_name', 'name', { unique: false });
          farmerStore.createIndex('by_phone', 'phone', { unique: false });
          farmerStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // 2. Liftings Store
        if (!db.objectStoreNames.contains('liftings')) {
          const liftingStore = db.createObjectStore('liftings', { keyPath: 'id' });
          liftingStore.createIndex('by_farmerId', 'farmerId', { unique: false });
          liftingStore.createIndex('by_date', 'liftingDate', { unique: false });
          liftingStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // 3. Cages Store
        if (!db.objectStoreNames.contains('cages')) {
          const cageStore = db.createObjectStore('cages', { keyPath: 'id' });
          cageStore.createIndex('by_liftingId', 'liftingId', { unique: false });
          cageStore.createIndex('by_farmerId', 'farmerId', { unique: false });
          cageStore.createIndex('by_isSold', 'isSold', { unique: false });
          cageStore.createIndex('by_cageNumber', 'cageNumber', { unique: false });
        }

        // 4. Stores Master
        if (!db.objectStoreNames.contains('stores')) {
          const storeStore = db.createObjectStore('stores', { keyPath: 'id' });
          storeStore.createIndex('by_name', 'name', { unique: true });
          storeStore.createIndex('by_phone', 'phone', { unique: false });
        }

        // 5. Sales Store
        if (!db.objectStoreNames.contains('sales')) {
          const saleStore = db.createObjectStore('sales', { keyPath: 'id' });
          saleStore.createIndex('by_storeId', 'storeId', { unique: false });
          saleStore.createIndex('by_cageId', 'cageId', { unique: true });
          saleStore.createIndex('by_liftingId', 'liftingId', { unique: false });
          saleStore.createIndex('by_saleDate', 'saleDate', { unique: false });
          saleStore.createIndex('by_invoiceNumber', 'invoiceNumber', { unique: true });
        }

        // 6. Payments Store (Store Ledger)
        if (!db.objectStoreNames.contains('payments')) {
          const paymentStore = db.createObjectStore('payments', { keyPath: 'id' });
          paymentStore.createIndex('by_storeId', 'storeId', { unique: false });
          paymentStore.createIndex('by_paymentDate', 'paymentDate', { unique: false });
        }

        // 7. Settings / Meta Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // 8. Singke Settlements Store (Settlement payments to Singke)
        if (!db.objectStoreNames.contains('singke_settlements')) {
          const singkeStore = db.createObjectStore('singke_settlements', { keyPath: 'id' });
          singkeStore.createIndex('by_date', 'date', { unique: false });
          singkeStore.createIndex('by_farmerId', 'farmerId', { unique: false });
          singkeStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
        setTimeout(() => {
          this.ensureWangkheiStore().catch(e => console.warn('Wangkhei auto-ensure notice:', e));
        }, 10);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  // Generate formatted unique sequential IDs
  async getNextId(prefix) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const counterKey = `seq_${prefix}`;
      const req = store.get(counterKey);

      req.onsuccess = () => {
        let currentSeq = req.result ? req.result.value : 0;
        currentSeq += 1;
        store.put({ key: counterKey, value: currentSeq });
        const padded = String(currentSeq).padStart(6, '0');
        resolve(`${prefix}-${padded}`);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async getNextInvoiceNumber(dateStr) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const ym = dateStr ? dateStr.replace(/-/g, '').slice(0, 6) : new Date().toISOString().slice(0, 7).replace('-', '');
      const counterKey = `seq_inv_${ym}`;
      const req = store.get(counterKey);

      req.onsuccess = () => {
        let currentSeq = req.result ? req.result.value : 0;
        currentSeq += 1;
        store.put({ key: counterKey, value: currentSeq });
        const padded = String(currentSeq).padStart(5, '0');
        resolve(`MPF-${ym}-${padded}`);
      };

      req.onerror = () => reject(req.error);
    });
  }

  // --- FARMER MASTER (Authoritative Single Source of Truth) ---
  async addFarmer(name, phone) {
    await this.init();
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();

    if (!cleanName) throw new Error('Farmer name is required.');
    if (!cleanPhone) throw new Error('Farmer phone number is required.');

    const id = await this.getNextId('FARM');
    const now = new Date().toISOString();
    const record = {
      id,
      name: cleanName,
      phone: cleanPhone,
      createdAt: now,
      updatedAt: now
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('farmers', 'readwrite');
      const store = tx.objectStore('farmers');
      const req = store.add(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async updateFarmer(id, name, phone) {
    await this.init();
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    if (!cleanName) throw new Error('Farmer name is required.');
    if (!cleanPhone) throw new Error('Farmer phone number is required.');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('farmers', 'readwrite');
      const store = tx.objectStore('farmers');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const farmer = getReq.result;
        if (!farmer) return reject(new Error('Farmer not found'));
        farmer.name = cleanName;
        farmer.phone = cleanPhone;
        farmer.updatedAt = new Date().toISOString();
        const putReq = store.put(farmer);
        putReq.onsuccess = () => resolve(farmer);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getFarmer(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('farmers', 'readonly');
      const store = tx.objectStore('farmers');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // Fast search with pagination - handles 100,000+ farmers using IndexedDB cursor
  async searchFarmers(query = '', page = 1, pageSize = 25) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('farmers', 'readonly');
      const store = tx.objectStore('farmers');
      const trimmed = query.trim().toLowerCase();
      const results = [];
      let totalMatched = 0;
      const skipCount = (page - 1) * pageSize;

      // Open cursor
      const req = store.openCursor(null, 'prev'); // Most recent first

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          return resolve({
            items: results,
            page,
            pageSize,
            total: totalMatched,
            hasMore: totalMatched > page * pageSize
          });
        }

        const farmer = cursor.value;
        const match = !trimmed ||
          farmer.name.toLowerCase().includes(trimmed) ||
          farmer.phone.includes(trimmed) ||
          farmer.id.toLowerCase().includes(trimmed);

        if (match) {
          totalMatched++;
          if (totalMatched > skipCount && results.length < pageSize) {
            results.push(farmer);
          }
        }

        // If we found enough for this page and counted some ahead, or continue cursor
        // For responsive search on huge databases, we can cap search count scan if needed
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async getFarmerCount() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('farmers', 'readonly');
      const store = tx.objectStore('farmers');
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async canDeleteFarmer(farmerId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('liftings', 'readonly');
      const store = tx.objectStore('liftings');
      const index = store.index('by_farmerId');
      const req = index.count(farmerId);
      req.onsuccess = () => {
        const count = req.result;
        resolve({
          canDelete: count === 0,
          reason: count > 0 ? `Farmer is linked to ${count} lifting record(s). Delete those liftings first.` : null
        });
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFarmer(farmerId) {
    const check = await this.canDeleteFarmer(farmerId);
    if (!check.canDelete) {
      throw new Error(check.reason);
    }
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('farmers', 'readwrite');
      const store = tx.objectStore('farmers');
      const req = store.delete(farmerId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- LIFTING & MULTI-CAGE MODULE ---
  async saveLiftingWithCages(liftingData, cagesList) {
    await this.init();
    if (!liftingData.farmerId) throw new Error('Farmer selection is required.');
    if (!liftingData.liftingDate) throw new Error('Lifting date is required.');
    if (!Array.isArray(cagesList) || cagesList.length === 0) {
      throw new Error('At least one cage must be added to the lifting.');
    }

    // Verify farmer exists in Farmer Master
    const farmer = await this.getFarmer(liftingData.farmerId);
    if (!farmer) throw new Error('Selected farmer does not exist in Farmer Master.');

    const liftingId = liftingData.id || await this.getNextId('LIFT');
    const now = new Date().toISOString();

    let totalWeight = 0;
    let totalBirds = 0;

    const cagesToSave = [];
    for (let i = 0; i < cagesList.length; i++) {
      const c = cagesList[i];
      const weight = parseFloat(c.weight);
      const count = parseInt(c.birdCount, 10);
      const cageNumber = String(c.cageNumber || '').trim();

      if (!cageNumber) throw new Error(`Cage #${i + 1} must have a cage number.`);
      if (isNaN(weight) || weight <= 0) throw new Error(`Cage ${cageNumber}: Invalid weight (must be > 0).`);
      if (isNaN(count) || count <= 0) throw new Error(`Cage ${cageNumber}: Invalid bird count (must be > 0).`);

      totalWeight += weight;
      totalBirds += count;

      const cageId = c.id || await this.getNextId('CAGE');
      cagesToSave.push({
        id: cageId,
        liftingId,
        farmerId: farmer.id,
        cageNumber,
        weight: Math.round(weight * 100) / 100,
        birdCount: count,
        isSold: c.isSold || false,
        saleId: c.saleId || null,
        createdAt: c.createdAt || now
      });
    }

    const liftingRate = parseFloat(liftingData.liftingRate) || 0;
    const liftingAmount = Math.round(totalWeight * liftingRate * 100) / 100;
    const remarks = (liftingData.remarks || '').trim();

    const liftingRecord = {
      id: liftingId,
      farmerId: farmer.id,
      liftingDate: liftingData.liftingDate,
      totalCages: cagesToSave.length,
      totalWeight: Math.round(totalWeight * 100) / 100,
      totalBirds,
      liftingRate,
      liftingAmount,
      remarks,
      payableToSingke: true,
      createdAt: liftingData.createdAt || now,
      updatedAt: now
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'cages'], 'readwrite');
      const liftingStore = tx.objectStore('liftings');
      const cageStore = tx.objectStore('cages');

      liftingStore.put(liftingRecord);

      for (const cage of cagesToSave) {
        cageStore.put(cage);
      }

      tx.oncomplete = () => resolve({ lifting: liftingRecord, cages: cagesToSave });
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLifting(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('liftings', 'readonly');
      const store = tx.objectStore('liftings');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getCagesByLifting(liftingId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('cages', 'readonly');
      const store = tx.objectStore('cages');
      const index = store.index('by_liftingId');
      const req = index.getAll(liftingId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getAvailableCagesByLifting(liftingId) {
    const allCages = await this.getCagesByLifting(liftingId);
    return allCages.filter(c => !c.isSold);
  }

  async getLiftings(page = 1, pageSize = 20) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'farmers'], 'readonly');
      const liftingStore = tx.objectStore('liftings');
      const farmerStore = tx.objectStore('farmers');
      const req = liftingStore.openCursor(null, 'prev');
      const results = [];
      let totalCount = 0;
      const skip = (page - 1) * pageSize;

      req.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          // Resolve with joined farmer data
          const joined = await Promise.all(results.map(async (lift) => {
            const farmer = await this.getFarmer(lift.farmerId);
            return {
              ...lift,
              farmerName: farmer ? farmer.name : 'Unknown Farmer',
              farmerPhone: farmer ? farmer.phone : ''
            };
          }));
          return resolve({
            items: joined,
            total: totalCount,
            page,
            pageSize,
            hasMore: totalCount > page * pageSize
          });
        }

        totalCount++;
        if (totalCount > skip && results.length < pageSize) {
          results.push(cursor.value);
        }
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async getLiftingsByDateRange(startDate, endDate) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'farmers'], 'readonly');
      const liftingStore = tx.objectStore('liftings');
      const dateIndex = liftingStore.index('by_date');

      let range = null;
      if (startDate && endDate) {
        const lower = startDate <= endDate ? startDate : endDate;
        const upper = startDate <= endDate ? endDate : startDate;
        range = IDBKeyRange.bound(lower, upper);
      } else if (startDate) {
        range = IDBKeyRange.lowerBound(startDate);
      } else if (endDate) {
        range = IDBKeyRange.upperBound(endDate);
      }

      const req = dateIndex.openCursor(range, 'prev');
      const results = [];

      req.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          const joined = await Promise.all(results.map(async (lift) => {
            const farmer = await this.getFarmer(lift.farmerId);
            return {
              ...lift,
              farmerName: farmer ? farmer.name : 'Unknown Farmer',
              farmerPhone: farmer ? farmer.phone : ''
            };
          }));
          return resolve(joined);
        }
        results.push(cursor.value);
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async getLiftingsByFarmer(farmerId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('liftings', 'readonly');
      const store = tx.objectStore('liftings');
      const index = store.index('by_farmerId');
      const req = index.getAll(farmerId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async canDeleteLifting(liftingId) {
    const cages = await this.getCagesByLifting(liftingId);
    const soldCages = cages.filter(c => c.isSold);
    if (soldCages.length > 0) {
      return {
        canDelete: false,
        reason: `Cannot delete lifting ${liftingId}. It contains ${soldCages.length} cage(s) (e.g. ${soldCages.map(c => c.cageNumber).join(', ')}) that are already sold in Store Sales. Delete the sales first.`
      };
    }
    return { canDelete: true, reason: null };
  }

  async deleteLifting(liftingId) {
    const check = await this.canDeleteLifting(liftingId);
    if (!check.canDelete) {
      throw new Error(check.reason);
    }
    const cages = await this.getCagesByLifting(liftingId);

    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'cages'], 'readwrite');
      const liftingStore = tx.objectStore('liftings');
      const cageStore = tx.objectStore('cages');

      liftingStore.delete(liftingId);
      for (const c of cages) {
        cageStore.delete(c.id);
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- STORES MASTER ---
  async addStore(name, phone, openingDue = 0) {
    await this.init();
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    if (!cleanName) throw new Error('Store name is required.');
    if (!cleanPhone) throw new Error('Store WhatsApp number is required.');

    // Check duplicate store name
    const existing = await this.getStoreByName(cleanName);
    if (existing) throw new Error(`A store with name "${cleanName}" already exists.`);

    const id = await this.getNextId('STORE');
    const storeRecord = {
      id,
      name: cleanName,
      phone: cleanPhone,
      openingDue: parseFloat(openingDue) || 0,
      createdAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readwrite');
      const store = tx.objectStore('stores');
      const req = store.add(storeRecord);
      req.onsuccess = () => resolve(storeRecord);
      req.onerror = () => reject(req.error);
    });
  }

  async updateStore(id, name, phone, openingDue = 0) {
    await this.init();
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    if (!cleanName) throw new Error('Store name is required.');
    if (!cleanPhone) throw new Error('Store WhatsApp number is required.');

    const existing = await this.getStoreByName(cleanName);
    if (existing && existing.id !== id) {
      throw new Error(`Another store with name "${cleanName}" already exists.`);
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readwrite');
      const store = tx.objectStore('stores');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return reject(new Error('Store not found'));
        record.name = cleanName;
        record.phone = cleanPhone;
        record.openingDue = parseFloat(openingDue) || 0;
        record.updatedAt = new Date().toISOString();
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(record);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getStore(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readonly');
      const store = tx.objectStore('stores');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getStoreByName(name) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readonly');
      const store = tx.objectStore('stores');
      const index = store.index('by_name');
      const req = index.get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllStores() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readonly');
      const store = tx.objectStore('stores');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async canDeleteStore(storeId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'payments'], 'readonly');
      const salesStore = tx.objectStore('sales');
      const salesIdx = salesStore.index('by_storeId');
      const paymentsStore = tx.objectStore('payments');
      const paymentsIdx = paymentsStore.index('by_storeId');

      const salesReq = salesIdx.count(storeId);
      salesReq.onsuccess = () => {
        const salesCount = salesReq.result;
        const payReq = paymentsIdx.count(storeId);
        payReq.onsuccess = () => {
          const payCount = payReq.result;
          if (salesCount > 0 || payCount > 0) {
            resolve({
              canDelete: false,
              reason: `Store has ${salesCount} sale(s) and ${payCount} payment(s) linked. Cannot delete store with financial history.`
            });
          } else {
            resolve({ canDelete: true, reason: null });
          }
        };
        payReq.onerror = () => reject(payReq.error);
      };
      salesReq.onerror = () => reject(salesReq.error);
    });
  }

  async deleteStore(storeId) {
    const check = await this.canDeleteStore(storeId);
    if (!check.canDelete) {
      throw new Error(check.reason);
    }
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readwrite');
      const store = tx.objectStore('stores');
      const req = store.delete(storeId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // Calculate actual store outstanding from all transactions
  async getStoreFinancialSummary(storeId) {
    await this.init();
    const store = await this.getStore(storeId);
    if (!store) throw new Error('Store not found');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'payments'], 'readonly');
      const salesStore = tx.objectStore('sales');
      const salesIdx = salesStore.index('by_storeId');
      const paymentsStore = tx.objectStore('payments');
      const paymentsIdx = paymentsStore.index('by_storeId');

      const salesReq = salesIdx.getAll(storeId);
      salesReq.onsuccess = () => {
        const sales = salesReq.result || [];
        const payReq = paymentsIdx.getAll(storeId);
        payReq.onsuccess = () => {
          const payments = payReq.result || [];

          let totalSalesAmount = 0;
          let totalSalePayments = 0;
          for (const s of sales) {
            totalSalesAmount += (s.saleAmount || 0);
            totalSalePayments += (s.paidAmount || 0);
          }

          let totalDirectPayments = 0;
          for (const p of payments) {
            totalDirectPayments += (p.amount || 0);
          }

          const openingDue = store.openingDue || 0;
          const totalPaid = totalSalePayments + totalDirectPayments;
          const currentOutstanding = openingDue + totalSalesAmount - totalPaid;

          resolve({
            store,
            openingDue: Math.round(openingDue * 100) / 100,
            totalSales: Math.round(totalSalesAmount * 100) / 100,
            salePayments: Math.round(totalSalePayments * 100) / 100,
            directPayments: Math.round(totalDirectPayments * 100) / 100,
            totalPaid: Math.round(totalPaid * 100) / 100,
            currentOutstanding: Math.round(currentOutstanding * 100) / 100,
            salesCount: sales.length,
            paymentsCount: payments.length
          });
        };
        payReq.onerror = () => reject(payReq.error);
      };
      salesReq.onerror = () => reject(salesReq.error);
    });
  }

  // --- SALES MODULE ---
  // Notice: Strict requirement: NO Farm Rate, NO Profit calculations!
  async saveSale(saleInput) {
    await this.init();
    const {
      storeId,
      saleDate,
      liftingId,
      cages: inputCages,
      cageId: singleCageId,
      weight: customWeight,
      salesRate,
      paidAmount,
      paymentMethod = 'Cash'
    } = saleInput;

    if (!storeId) throw new Error('Store is required.');
    if (!saleDate) throw new Error('Sale date is required.');
    if (!liftingId) throw new Error('Lifting reference is required.');

    // Normalize cages to sell (supporting both multi-cage array and legacy single-cage format)
    let cagesToSell = [];
    if (Array.isArray(inputCages) && inputCages.length > 0) {
      cagesToSell = inputCages;
    } else if (singleCageId) {
      cagesToSell = [{ cageId: singleCageId, weight: customWeight }];
    }

    if (cagesToSell.length === 0) {
      throw new Error('At least one cage must be selected for billing.');
    }

    const rate = parseFloat(salesRate);
    if (isNaN(rate) || rate <= 0) throw new Error('Sales rate must be greater than 0.');

    const payment = parseFloat(paidAmount) || 0;
    if (payment < 0) throw new Error('Paid amount cannot be negative.');

    // Fetch store
    const store = await this.getStore(storeId);
    if (!store) throw new Error('Store not found.');

    // Fetch and validate all cages
    const resolvedCages = [];
    let totalBilledWeight = 0;
    let totalOriginalWeight = 0;
    let totalBirds = 0;

    for (const item of cagesToSell) {
      const cageRecord = await new Promise((res, rej) => {
        const tx = this.db.transaction('cages', 'readonly');
        const req = tx.objectStore('cages').get(item.cageId);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });

      if (!cageRecord) throw new Error(`Selected cage ${item.cageId} not found.`);

      // Check cage availability (unless editing same sale)
      if (cageRecord.isSold && cageRecord.saleId !== saleInput.id) {
        throw new Error(`Cage ${cageRecord.cageNumber} is already sold in another sale.`);
      }

      const w = (item.weight !== undefined && item.weight !== null && !isNaN(parseFloat(item.weight)) && parseFloat(item.weight) > 0)
        ? Math.round(parseFloat(item.weight) * 100) / 100
        : (cageRecord.weight || 0);

      if (w <= 0) throw new Error(`Billed weight for Cage ${cageRecord.cageNumber} must be greater than 0.`);

      totalBilledWeight += w;
      totalOriginalWeight += (cageRecord.weight || 0);
      totalBirds += (cageRecord.birdCount || 0);

      resolvedCages.push({
        cageRecord,
        cageId: cageRecord.id,
        cageNumber: cageRecord.cageNumber,
        originalWeight: cageRecord.weight,
        weight: w,
        birdCount: cageRecord.birdCount || 0
      });
    }

    totalBilledWeight = Math.round(totalBilledWeight * 100) / 100;
    totalOriginalWeight = Math.round(totalOriginalWeight * 100) / 100;

    const saleAmount = Math.round(totalBilledWeight * rate * 100) / 100;

    // Get store's current outstanding before this sale
    const fin = await this.getStoreFinancialSummary(storeId);
    let previousDue = fin.currentOutstanding;

    // If editing existing sale, adjust previous due
    if (saleInput.id) {
      const existingSale = await this.getSale(saleInput.id);
      if (existingSale) {
        previousDue = previousDue - (existingSale.saleAmount - existingSale.paidAmount);
      }
    }

    const outstanding = Math.round((previousDue + saleAmount - payment) * 100) / 100;

    const saleId = saleInput.id || await this.getNextId('SALE');
    const invoiceNumber = saleInput.invoiceNumber || await this.getNextInvoiceNumber(saleDate);
    const now = new Date().toISOString();

    const cageNumbersText = resolvedCages.map(c => c.cageNumber).join(', ');
    const displayCageText = resolvedCages.length === 1
      ? resolvedCages[0].cageNumber
      : `${cageNumbersText} (${resolvedCages.length} cages)`;

    const isWangkhei = (store.name && store.name.toLowerCase().includes('wangkhei')) || store.isWangkhei;
    const defaultRemarks = isWangkhei ? 'Wangkhei Store bird sale (Auto-deducted from Singke due)' : '';
    const remarks = saleInput.remarks ? saleInput.remarks.trim() : defaultRemarks;

    const saleRecord = {
      id: saleId,
      invoiceNumber,
      storeId,
      saleDate,
      liftingId,
      isWangkheiSale: !!isWangkhei,
      remarks,
      cages: resolvedCages.map(c => ({
        cageId: c.cageId,
        cageNumber: c.cageNumber,
        originalWeight: c.originalWeight,
        weight: c.weight,
        birdCount: c.birdCount
      })),
      totalCages: resolvedCages.length,
      totalBirds,
      // Backward compatibility fields:
      cageId: resolvedCages[0].cageId,
      cageNumber: displayCageText,
      weight: totalBilledWeight,
      originalCageWeight: totalOriginalWeight,
      salesRate: rate,
      saleAmount,
      previousDue: Math.round(previousDue * 100) / 100,
      paidAmount: Math.round(payment * 100) / 100,
      outstanding,
      paymentMethod,
      createdAt: saleInput.createdAt || now
    };

    // Atomic update: save sale, mark ALL cages as sold
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'cages'], 'readwrite');
      const salesStore = tx.objectStore('sales');
      const cagesStore = tx.objectStore('cages');

      salesStore.put(saleRecord);

      for (const item of resolvedCages) {
        const c = item.cageRecord;
        c.isSold = true;
        c.saleId = saleId;
        c.soldWeight = item.weight;
        cagesStore.put(c);
      }

      tx.oncomplete = () => resolve(saleRecord);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSale(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sales', 'readonly');
      const store = tx.objectStore('sales');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getSales(page = 1, pageSize = 20) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'stores'], 'readonly');
      const salesStore = tx.objectStore('sales');
      const req = salesStore.openCursor(null, 'prev');
      const results = [];
      let totalCount = 0;
      const skip = (page - 1) * pageSize;

      req.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          const joined = await Promise.all(results.map(async (sale) => {
            const store = await this.getStore(sale.storeId);
            return {
              ...sale,
              storeName: store ? store.name : 'Unknown Store',
              storePhone: store ? store.phone : ''
            };
          }));
          return resolve({
            items: joined,
            total: totalCount,
            page,
            pageSize,
            hasMore: totalCount > page * pageSize
          });
        }

        totalCount++;
        if (totalCount > skip && results.length < pageSize) {
          results.push(cursor.value);
        }
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async deleteSale(saleId) {
    await this.init();
    const sale = await this.getSale(saleId);
    if (!sale) throw new Error('Sale not found.');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'cages'], 'readwrite');
      const salesStore = tx.objectStore('sales');
      const cagesStore = tx.objectStore('cages');

      // Determine cage IDs to unmark
      const cageIds = (sale.cages && Array.isArray(sale.cages) && sale.cages.length > 0)
        ? sale.cages.map(c => c.cageId)
        : (sale.cageId ? [sale.cageId] : []);

      for (const id of cageIds) {
        const cageReq = cagesStore.get(id);
        cageReq.onsuccess = () => {
          const cage = cageReq.result;
          if (cage) {
            cage.isSold = false;
            cage.saleId = null;
            cage.soldWeight = null;
            cagesStore.put(cage);
          }
        };
      }

      salesStore.delete(saleId);

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- LEDGER / DIRECT STORE PAYMENTS ---
  async addPayment(paymentInput) {
    await this.init();
    const { storeId, paymentDate, amount, paymentMethod = 'Cash', notes = '' } = paymentInput;

    if (!storeId) throw new Error('Store is required.');
    if (!paymentDate) throw new Error('Payment date is required.');
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) throw new Error('Payment amount must be greater than 0.');

    const store = await this.getStore(storeId);
    if (!store) throw new Error('Store not found.');

    const id = paymentInput.id || await this.getNextId('PAY');
    const record = {
      id,
      storeId,
      paymentDate,
      amount: Math.round(amt * 100) / 100,
      paymentMethod,
      notes: (notes || '').trim(),
      createdAt: paymentInput.createdAt || new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('payments', 'readwrite');
      const storeObj = tx.objectStore('payments');
      const req = storeObj.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async getPayments(page = 1, pageSize = 20) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['payments', 'stores'], 'readonly');
      const paymentsStore = tx.objectStore('payments');
      const req = paymentsStore.openCursor(null, 'prev');
      const results = [];
      let totalCount = 0;
      const skip = (page - 1) * pageSize;

      req.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          const joined = await Promise.all(results.map(async (pay) => {
            const store = await this.getStore(pay.storeId);
            return {
              ...pay,
              storeName: store ? store.name : 'Unknown Store'
            };
          }));
          return resolve({
            items: joined,
            total: totalCount,
            page,
            pageSize,
            hasMore: totalCount > page * pageSize
          });
        }

        totalCount++;
        if (totalCount > skip && results.length < pageSize) {
          results.push(cursor.value);
        }
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async deletePayment(paymentId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('payments', 'readwrite');
      const store = tx.objectStore('payments');
      const req = store.delete(paymentId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- STORE STATEMENT ---
  async getStoreStatement(storeId) {
    await this.init();
    const store = await this.getStore(storeId);
    if (!store) throw new Error('Store not found.');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'payments'], 'readonly');
      const salesIdx = tx.objectStore('sales').index('by_storeId');
      const payIdx = tx.objectStore('payments').index('by_storeId');

      const sReq = salesIdx.getAll(storeId);
      sReq.onsuccess = () => {
        const sales = sReq.result || [];
        const pReq = payIdx.getAll(storeId);
        pReq.onsuccess = () => {
          const payments = pReq.result || [];

          // Combine transactions chronologically
          const entries = [];

          if ((store.openingDue || 0) !== 0) {
            entries.push({
              date: store.createdAt ? store.createdAt.slice(0, 10) : 'Opening',
              type: 'OPENING',
              ref: 'Opening Due',
              debit: store.openingDue > 0 ? store.openingDue : 0,
              credit: store.openingDue < 0 ? Math.abs(store.openingDue) : 0,
              details: 'Initial Balance Recorded'
            });
          }

          for (const s of sales) {
            entries.push({
              date: s.saleDate,
              type: 'SALE',
              ref: s.invoiceNumber,
              debit: s.saleAmount,
              credit: s.paidAmount,
              details: `Cage ${s.cageNumber} (${s.weight} kg @ ₹${s.salesRate}/kg)`
            });
          }

          for (const p of payments) {
            entries.push({
              date: p.paymentDate,
              type: 'PAYMENT',
              ref: p.id,
              debit: 0,
              credit: p.amount,
              details: `Payment via ${p.paymentMethod}${p.notes ? ' - ' + p.notes : ''}`
            });
          }

          // Sort by date ascending
          entries.sort((a, b) => (a.date > b.date ? 1 : -1));

          // Compute running balance
          let runningBalance = 0;
          for (const entry of entries) {
            runningBalance += (entry.debit - entry.credit);
            entry.balance = Math.round(runningBalance * 100) / 100;
          }

          resolve({
            store,
            entries,
            finalBalance: Math.round(runningBalance * 100) / 100
          });
        };
        pReq.onerror = () => reject(pReq.error);
      };
      sReq.onerror = () => reject(sReq.error);
    });
  }

  // --- FARMER REPORT DATA ---
  async getFarmerReport(farmerId) {
    await this.init();
    const farmer = await this.getFarmer(farmerId);
    if (!farmer) throw new Error('Farmer not found.');

    const liftings = await this.getLiftingsByFarmer(farmerId);
    let totalCages = 0;
    let totalBirds = 0;
    let totalWeight = 0;

    const detailedLiftings = await Promise.all(liftings.map(async (l) => {
      const cages = await this.getCagesByLifting(l.id);
      totalCages += cages.length;
      totalBirds += l.totalBirds;
      totalWeight += l.totalWeight;
      return {
        ...l,
        cages
      };
    }));

    // Sort by date descending
    detailedLiftings.sort((a, b) => (a.liftingDate < b.liftingDate ? 1 : -1));

    let financial = null;
    try {
      financial = await this.getFarmerFinancialSummary(farmerId);
    } catch (e) {
      console.warn('Financial summary load note:', e);
    }

    return {
      farmer,
      totalLiftings: liftings.length,
      totalCages,
      totalBirds,
      totalWeight: Math.round(totalWeight * 100) / 100,
      avgWeightPerBird: totalBirds > 0 ? (Math.round((totalWeight / totalBirds) * 100) / 100) : 0,
      liftings: detailedLiftings,
      financial
    };
  }

  // --- DASHBOARD DATA & RECONCILIATION ---
  async getDashboardData(startDate, endDate) {
    await this.init();
    const today = new Date().toISOString().slice(0, 10);
    const filterStart = (startDate !== undefined && startDate !== null) ? startDate : today;
    const filterEnd = (endDate !== undefined && endDate !== null) ? endDate : today;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'cages', 'sales', 'stores', 'payments'], 'readonly');
      const liftingsStore = tx.objectStore('liftings');
      const cagesStore = tx.objectStore('cages');
      const salesStore = tx.objectStore('sales');
      const storesStore = tx.objectStore('stores');
      const paymentsStore = tx.objectStore('payments');

      const allLiftingsReq = liftingsStore.getAll();
      allLiftingsReq.onsuccess = () => {
        const liftings = allLiftingsReq.result || [];
        const allCagesReq = cagesStore.getAll();

        allCagesReq.onsuccess = () => {
          const cages = allCagesReq.result || [];
          const allSalesReq = salesStore.getAll();

          allSalesReq.onsuccess = () => {
            const sales = allSalesReq.result || [];
            const allStoresReq = storesStore.getAll();

            allStoresReq.onsuccess = () => {
              const stores = allStoresReq.result || [];
              const allPaymentsReq = paymentsStore.getAll();

              allPaymentsReq.onsuccess = () => {
                const payments = allPaymentsReq.result || [];

                const inRange = (d) => {
                  if (!d) return false;
                  if (filterStart && filterEnd) return d >= filterStart && d <= filterEnd;
                  if (filterStart) return d >= filterStart;
                  if (filterEnd) return d <= filterEnd;
                  return true;
                };

                // Range stats
                const isFiltered = Boolean(filterStart || filterEnd);
                const rangeLiftings = isFiltered ? liftings.filter(l => inRange(l.liftingDate)) : liftings;
                let rangeCagesLifted = 0;
                let rangeWeight = 0;
                let rangeBirds = 0;
                for (const l of rangeLiftings) {
                  rangeCagesLifted += (l.totalCages || 0);
                  rangeWeight += (l.totalWeight || 0);
                  rangeBirds += (l.totalBirds || 0);
                }

                const rangeSales = isFiltered ? sales.filter(s => inRange(s.saleDate)) : sales;
                let rangeSalesAmount = 0;
                let rangeSalesCollected = 0;
                for (const s of rangeSales) {
                  rangeSalesAmount += (s.saleAmount || 0);
                  rangeSalesCollected += (s.paidAmount || 0);
                }

                const rangePayments = isFiltered ? payments.filter(p => inRange(p.paymentDate)) : payments;
                let rangeDirectPayments = 0;
                for (const p of rangePayments) {
                  rangeDirectPayments += (p.amount || 0);
                }

                const totalRangeCollected = rangeSalesCollected + rangeDirectPayments;
                const rangeNetOutstanding = rangeSalesAmount - totalRangeCollected;

                // Total cage reconciliation
                const totalLiftedCages = cages.length;
                const soldCages = cages.filter(c => c.isSold).length;
                const remainingCages = totalLiftedCages - soldCages;
                let remainingWeight = 0;
                for (const c of cages) {
                  if (!c.isSold) remainingWeight += (c.weight || 0);
                }

                // Store total outstanding
                let totalStoreOutstanding = 0;
                for (const st of stores) {
                  let storeSalesAmt = 0;
                  let storePaid = 0;
                  for (const s of sales) {
                    if (s.storeId === st.id) {
                      storeSalesAmt += (s.saleAmount || 0);
                      storePaid += (s.paidAmount || 0);
                    }
                  }
                  for (const p of payments) {
                    if (p.storeId === st.id) {
                      storePaid += (p.amount || 0);
                    }
                  }
                  totalStoreOutstanding += ((st.openingDue || 0) + storeSalesAmt - storePaid);
                }

                resolve({
                  today,
                  filterStart,
                  filterEnd,
                  rangeStats: {
                    cagesLifted: rangeCagesLifted,
                    totalWeight: Math.round(rangeWeight * 100) / 100,
                    totalBirds: rangeBirds,
                    salesAmount: Math.round(rangeSalesAmount * 100) / 100,
                    collectedAmount: Math.round(totalRangeCollected * 100) / 100,
                    periodOutstanding: Math.round(rangeNetOutstanding * 100) / 100,
                    totalStoreOutstanding: Math.round(totalStoreOutstanding * 100) / 100
                  },
                  todayStats: {
                    cagesLifted: rangeCagesLifted,
                    totalWeight: Math.round(rangeWeight * 100) / 100,
                    salesAmount: Math.round(rangeSalesAmount * 100) / 100,
                    storeOutstanding: Math.round(rangeNetOutstanding * 100) / 100
                  },
                  reconciliation: {
                    totalLiftedCages,
                    soldCages,
                    remainingCages,
                    remainingWeight: Math.round(remainingWeight * 100) / 100
                  },
                  todayLiftingsCount: rangeLiftings.length,
                  rangeLiftingsCount: rangeLiftings.length,
                  totalFarmersCount: 0 // populated separately if needed
                });
              };
            };
          };
        };
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  // --- ACCOUNTING SUMMARY ---
  async getAccountingSummary(startDate, endDate) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'payments', 'liftings', 'stores'], 'readonly');
      const salesReq = tx.objectStore('sales').getAll();
      const payReq = tx.objectStore('payments').getAll();
      const liftReq = tx.objectStore('liftings').getAll();
      const storesReq = tx.objectStore('stores').getAll();

      salesReq.onsuccess = () => {
        const sales = (salesReq.result || []).filter(s => {
          if (startDate && s.saleDate < startDate) return false;
          if (endDate && s.saleDate > endDate) return false;
          return true;
        });

        payReq.onsuccess = () => {
          const payments = (payReq.result || []).filter(p => {
            if (startDate && p.paymentDate < startDate) return false;
            if (endDate && p.paymentDate > endDate) return false;
            return true;
          });

          liftReq.onsuccess = () => {
            const liftings = (liftReq.result || []).filter(l => {
              if (startDate && l.liftingDate < startDate) return false;
              if (endDate && l.liftingDate > endDate) return false;
              return true;
            });

            storesReq.onsuccess = () => {
              const stores = storesReq.result || [];

              let totalSalesIncome = 0;
              let salePaymentsReceived = 0;
              for (const s of sales) {
                totalSalesIncome += (s.saleAmount || 0);
                salePaymentsReceived += (s.paidAmount || 0);
              }

              let directPaymentsReceived = 0;
              for (const p of payments) {
                directPaymentsReceived += (p.amount || 0);
              }

              const totalPaymentsReceived = salePaymentsReceived + directPaymentsReceived;

              let totalLiftingWeight = 0;
              let totalLiftingBirds = 0;
              let totalCagesLifted = 0;
              for (const l of liftings) {
                totalLiftingWeight += (l.totalWeight || 0);
                totalLiftingBirds += (l.totalBirds || 0);
                totalCagesLifted += (l.totalCages || 0);
              }

              // Overall Store Outstanding
              let totalOutstanding = 0;
              for (const st of stores) {
                // Calculate balance from stores
                totalOutstanding += (st.openingDue || 0);
              }
              // Add uncollected sales
              totalOutstanding += (totalSalesIncome - totalPaymentsReceived);

              resolve({
                startDate: startDate || 'All Time',
                endDate: endDate || 'Present',
                totalSalesIncome: Math.round(totalSalesIncome * 100) / 100,
                salePaymentsReceived: Math.round(salePaymentsReceived * 100) / 100,
                directPaymentsReceived: Math.round(directPaymentsReceived * 100) / 100,
                totalPaymentsReceived: Math.round(totalPaymentsReceived * 100) / 100,
                totalOutstanding: Math.round(totalOutstanding * 100) / 100,
                totalLiftingWeight: Math.round(totalLiftingWeight * 100) / 100,
                totalLiftingBirds,
                totalCagesLifted,
                salesCount: sales.length,
                paymentsCount: payments.length,
                liftingsCount: liftings.length
              });
            };
          };
        };
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // --- SINGKE & WANGKHEI ACCOUNTING ENGINE ---
  // ==========================================

  async ensureWangkheiStore() {
    if (!this.db) await this.init();
    const existing = await this.getStoreByName('Wangkhei Store');
    if (existing) {
      if (!existing.isWangkhei) {
        existing.isWangkhei = true;
        existing.singkeAccount = 'Singke';
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction('stores', 'readwrite');
          const req = tx.objectStore('stores').put(existing);
          req.onsuccess = () => resolve(existing);
          req.onerror = () => reject(req.error);
        });
      }
      return existing;
    }

    const id = 'STORE-WANGKHEI';
    const now = new Date().toISOString();
    const record = {
      id,
      name: 'Wangkhei Store',
      phone: '9876543210',
      openingDue: 0,
      isWangkhei: true,
      singkeAccount: 'Singke',
      notes: 'Store belongs to Singke. All bird sales are auto-deducted from amount payable to Singke.',
      createdAt: now,
      updatedAt: now
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stores', 'readwrite');
      const req = tx.objectStore('stores').put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async addSingkeSettlement(data) {
    await this.init();
    const amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Settlement amount must be greater than 0.');
    if (!data.date) throw new Error('Settlement date is required.');

    const id = await this.getNextId('SETTLE');
    const now = new Date().toISOString();
    const record = {
      id,
      date: data.date,
      amount: Math.round(amount * 100) / 100,
      paymentMethod: data.paymentMethod || 'Cash',
      referenceNumber: (data.referenceNumber || '').trim(),
      farmerId: (data.farmerId || '').trim(),
      remarks: (data.remarks || '').trim() || 'Settlement payment to Singke',
      type: data.type || 'SETTLEMENT',
      createdAt: now,
      updatedAt: now
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('singke_settlements', 'readwrite');
      const store = tx.objectStore('singke_settlements');
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async updateSingkeSettlement(id, updateData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('singke_settlements', 'readwrite');
      const store = tx.objectStore('singke_settlements');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return reject(new Error('Settlement record not found.'));
        if (updateData.date) record.date = updateData.date;
        if (updateData.amount !== undefined) {
          const amt = parseFloat(updateData.amount);
          if (isNaN(amt) || amt <= 0) return reject(new Error('Invalid settlement amount.'));
          record.amount = Math.round(amt * 100) / 100;
        }
        if (updateData.paymentMethod) record.paymentMethod = updateData.paymentMethod;
        if (updateData.referenceNumber !== undefined) record.referenceNumber = (updateData.referenceNumber || '').trim();
        if (updateData.farmerId !== undefined) record.farmerId = (updateData.farmerId || '').trim();
        if (updateData.remarks !== undefined) record.remarks = (updateData.remarks || '').trim();
        record.updatedAt = new Date().toISOString();
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(record);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteSingkeSettlement(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('singke_settlements', 'readwrite');
      const store = tx.objectStore('singke_settlements');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async getSingkeSettlements(startDate, endDate, farmerId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['singke_settlements', 'farmers'], 'readonly');
      const settleStore = tx.objectStore('singke_settlements');
      const farmerStore = tx.objectStore('farmers');

      const settleReq = settleStore.getAll();
      settleReq.onsuccess = () => {
        let items = settleReq.result || [];
        if (startDate) items = items.filter(s => s.date >= startDate);
        if (endDate) items = items.filter(s => s.date <= endDate);
        if (farmerId) items = items.filter(s => s.farmerId === farmerId);

        const farmerReq = farmerStore.getAll();
        farmerReq.onsuccess = () => {
          const farmers = farmerReq.result || [];
          const map = new Map(farmers.map(f => [f.id, f]));
          const joined = items.map(st => {
            const f = st.farmerId ? map.get(st.farmerId) : null;
            return {
              ...st,
              farmerName: f ? f.name : (st.farmerId ? `Farmer #${st.farmerId}` : 'General Singke Account')
            };
          });
          joined.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? 1 : -1;
            return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
          });
          resolve(joined);
        };
        farmerReq.onerror = () => reject(farmerReq.error);
      };
      settleReq.onerror = () => reject(settleReq.error);
    });
  }

  async updateLiftingRateAndRemarks(liftingId, rate, remarks) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('liftings', 'readwrite');
      const store = tx.objectStore('liftings');
      const getReq = store.get(liftingId);
      getReq.onsuccess = () => {
        const lifting = getReq.result;
        if (!lifting) return reject(new Error('Lifting not found.'));
        const r = parseFloat(rate);
        if (isNaN(r) || r < 0) return reject(new Error('Invalid rate'));
        lifting.liftingRate = r;
        lifting.liftingAmount = Math.round((lifting.totalWeight * r) * 100) / 100;
        if (remarks !== undefined) lifting.remarks = (remarks || '').trim();
        lifting.updatedAt = new Date().toISOString();
        const putReq = store.put(lifting);
        putReq.onsuccess = () => resolve(lifting);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async updateSaleRemarks(saleId, remarks) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sales', 'readwrite');
      const store = tx.objectStore('sales');
      const getReq = store.get(saleId);
      getReq.onsuccess = () => {
        const sale = getReq.result;
        if (!sale) return reject(new Error('Sale not found.'));
        sale.remarks = (remarks || '').trim();
        sale.updatedAt = new Date().toISOString();
        const putReq = store.put(sale);
        putReq.onsuccess = () => resolve(sale);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getSingkeAccountSummary(startDate, endDate) {
    await this.init();
    const stores = await this.getAllStores();
    const wangkheiStoreIds = new Set(
      stores.filter(s => (s.name && s.name.toLowerCase().includes('wangkhei')) || s.isWangkhei).map(s => s.id)
    );

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'sales', 'singke_settlements'], 'readonly');
      const liftReq = tx.objectStore('liftings').getAll();
      const saleReq = tx.objectStore('sales').getAll();
      const settleReq = tx.objectStore('singke_settlements').getAll();

      liftReq.onsuccess = () => {
        const liftings = (liftReq.result || []).filter(l => {
          if (startDate && l.liftingDate < startDate) return false;
          if (endDate && l.liftingDate > endDate) return false;
          return true;
        });

        saleReq.onsuccess = () => {
          const sales = (saleReq.result || []).filter(s => {
            if (!wangkheiStoreIds.has(s.storeId) && !s.isWangkheiSale) return false;
            if (startDate && s.saleDate < startDate) return false;
            if (endDate && s.saleDate > endDate) return false;
            return true;
          });

          settleReq.onsuccess = () => {
            const settlements = (settleReq.result || []).filter(st => {
              if (startDate && st.date < startDate) return false;
              if (endDate && st.date > endDate) return false;
              return true;
            });

            // 1. Total farmer lifting value payable through Singke
            let totalLiftingWeight = 0;
            let totalLiftingBirds = 0;
            let totalLiftingCages = 0;
            let totalLiftingAmount = 0;
            for (const l of liftings) {
              totalLiftingWeight += (l.totalWeight || 0);
              totalLiftingBirds += (l.totalBirds || 0);
              totalLiftingCages += (l.totalCages || 0);
              const rate = l.liftingRate || 0;
              const amt = l.liftingAmount !== undefined ? l.liftingAmount : Math.round((l.totalWeight * rate) * 100) / 100;
              totalLiftingAmount += amt;
            }

            // 2. Total Wangkhei Store deductions
            let totalWangkheiSalesAmount = 0;
            let totalWangkheiWeight = 0;
            let totalWangkheiCages = 0;
            for (const s of sales) {
              totalWangkheiSalesAmount += (s.saleAmount || 0);
              totalWangkheiWeight += (s.weight || 0);
              totalWangkheiCages += (s.totalCages || (s.cages ? s.cages.length : 1));
            }

            // 3. Total other settlements / payouts
            let totalOtherSettlements = 0;
            for (const st of settlements) {
              totalOtherSettlements += (st.amount || 0);
            }

            // 4. Formula: Remaining Due = Total Payable - Wangkhei Deductions - Other Settlements
            const totalSettled = totalWangkheiSalesAmount + totalOtherSettlements;
            const remainingDueToSingke = totalLiftingAmount - totalSettled;

            resolve({
              startDate: startDate || 'All Time',
              endDate: endDate || 'Present',
              totalLiftingWeight: Math.round(totalLiftingWeight * 100) / 100,
              totalLiftingBirds,
              totalLiftingCages,
              totalLiftingAmount: Math.round(totalLiftingAmount * 100) / 100,
              liftingsCount: liftings.length,

              totalWangkheiSalesAmount: Math.round(totalWangkheiSalesAmount * 100) / 100,
              totalWangkheiWeight: Math.round(totalWangkheiWeight * 100) / 100,
              totalWangkheiCages,
              wangkheiSalesCount: sales.length,

              totalOtherSettlements: Math.round(totalOtherSettlements * 100) / 100,
              settlementsCount: settlements.length,

              totalSettled: Math.round(totalSettled * 100) / 100,
              remainingDueToSingke: Math.round(remainingDueToSingke * 100) / 100
            });
          };
          settleReq.onerror = () => reject(settleReq.error);
        };
        saleReq.onerror = () => reject(saleReq.error);
      };
      liftReq.onerror = () => reject(liftReq.error);
    });
  }

  async getSingkeLedger(startDate, endDate, filterType = 'all', searchQuery = '') {
    await this.init();
    const stores = await this.getAllStores();
    const wangkheiStoreIds = new Set(
      stores.filter(s => (s.name && s.name.toLowerCase().includes('wangkhei')) || s.isWangkhei).map(s => s.id)
    );

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'sales', 'singke_settlements', 'farmers'], 'readonly');
      const liftReq = tx.objectStore('liftings').getAll();
      const saleReq = tx.objectStore('sales').getAll();
      const settleReq = tx.objectStore('singke_settlements').getAll();
      const farmerReq = tx.objectStore('farmers').getAll();

      liftReq.onsuccess = () => {
        const liftings = liftReq.result || [];
        saleReq.onsuccess = () => {
          const sales = (saleReq.result || []).filter(s => wangkheiStoreIds.has(s.storeId) || s.isWangkheiSale);
          settleReq.onsuccess = () => {
            const settlements = settleReq.result || [];
            farmerReq.onsuccess = () => {
              const farmers = farmerReq.result || [];
              const farmerMap = new Map(farmers.map(f => [f.id, f]));
              const liftingMap = new Map(liftings.map(l => [l.id, l]));

              const entries = [];

              // Stream 1: Farmer Liftings (INCREASE / Credit payable to Singke)
              for (const l of liftings) {
                const f = farmerMap.get(l.farmerId);
                const farmerName = f ? f.name : 'Unknown Farmer';
                const rate = l.liftingRate || 0;
                const amt = l.liftingAmount !== undefined ? l.liftingAmount : Math.round((l.totalWeight * rate) * 100) / 100;

                entries.push({
                  id: `LEDGER-LIFT-${l.id}`,
                  date: l.liftingDate,
                  createdAt: l.createdAt || l.liftingDate,
                  type: 'LIFTING_PAYABLE',
                  typeLabel: 'Farmer Lifting',
                  direction: 'INCREASE',
                  rawAmount: amt,
                  credit: amt,
                  debit: 0,
                  effect: amt,
                  referenceId: l.id,
                  farmerId: l.farmerId,
                  farmerName,
                  description: `Farmer Lifting - ${farmerName} (${l.totalWeight} kg @ ₹${rate}/kg, ${l.totalBirds} birds)`,
                  remarks: l.remarks || 'Farmer lifting payable through Singke',
                  weight: l.totalWeight,
                  birds: l.totalBirds,
                  rate,
                  entityId: l.id,
                  entityType: 'lifting'
                });
              }

              // Stream 2: Wangkhei Store Sales (DECREASE / Debit deduction from Singke)
              for (const s of sales) {
                const lifting = liftingMap.get(s.liftingId);
                const f = lifting ? farmerMap.get(lifting.farmerId) : null;
                const farmerName = f ? f.name : (lifting ? `Farmer #${lifting.farmerId}` : 'Wangkhei Store');
                const amt = s.saleAmount || 0;

                entries.push({
                  id: `LEDGER-WANGKHEI-${s.id}`,
                  date: s.saleDate,
                  createdAt: s.createdAt || s.saleDate,
                  type: 'WANGKHEI_DEDUCTION',
                  typeLabel: 'Wangkhei Store Sale',
                  direction: 'DECREASE',
                  rawAmount: amt,
                  credit: 0,
                  debit: amt,
                  effect: -amt,
                  referenceId: s.invoiceNumber,
                  saleId: s.id,
                  liftingId: s.liftingId,
                  farmerId: f ? f.id : '',
                  farmerName,
                  description: `Wangkhei Store Sale (Inv: ${s.invoiceNumber}) - ${s.weight} kg @ ₹${s.salesRate}/kg [Farmer: ${farmerName}]`,
                  remarks: s.remarks || 'Automatic Wangkhei Store bird sale deduction',
                  weight: s.weight,
                  birds: s.totalBirds || 0,
                  rate: s.salesRate,
                  cagesCount: s.totalCages || (s.cages ? s.cages.length : 1),
                  entityId: s.id,
                  entityType: 'sale'
                });
              }

              // Stream 3: Direct Settlements / Payouts (DECREASE / Debit payment to Singke)
              for (const st of settlements) {
                const f = st.farmerId ? farmerMap.get(st.farmerId) : null;
                const farmerName = f ? f.name : 'General Singke Account';
                const amt = st.amount || 0;

                entries.push({
                  id: `LEDGER-SETTLE-${st.id}`,
                  date: st.date,
                  createdAt: st.createdAt || st.date,
                  type: 'OTHER_SETTLEMENT',
                  typeLabel: 'Direct Settlement',
                  direction: 'DECREASE',
                  rawAmount: amt,
                  credit: 0,
                  debit: amt,
                  effect: -amt,
                  referenceId: st.referenceNumber || st.id,
                  settlementId: st.id,
                  farmerId: st.farmerId || '',
                  farmerName,
                  paymentMethod: st.paymentMethod,
                  description: `Settlement to Singke via ${st.paymentMethod}${st.referenceNumber ? ' (Ref: ' + st.referenceNumber + ')' : ''}`,
                  remarks: st.remarks || 'Settlement payout to Singke',
                  entityId: st.id,
                  entityType: 'settlement'
                });
              }

              // Sort chronologically ascending for running balance
              entries.sort((a, b) => {
                if (a.date !== b.date) return a.date > b.date ? 1 : -1;
                return (a.createdAt || '') > (b.createdAt || '') ? 1 : -1;
              });

              // Calculate Running Balance
              let runningBalance = 0;
              let totalPayables = 0;
              let totalDeductions = 0;
              let totalSettlements = 0;

              for (const entry of entries) {
                if (entry.direction === 'INCREASE') {
                  runningBalance += entry.rawAmount;
                  totalPayables += entry.rawAmount;
                } else {
                  runningBalance -= entry.rawAmount;
                  if (entry.type === 'WANGKHEI_DEDUCTION') {
                    totalDeductions += entry.rawAmount;
                  } else {
                    totalSettlements += entry.rawAmount;
                  }
                }
                entry.runningBalance = Math.round(runningBalance * 100) / 100;
              }

              // Apply filtering if specified
              let filtered = entries;
              if (startDate) filtered = filtered.filter(e => e.date >= startDate);
              if (endDate) filtered = filtered.filter(e => e.date <= endDate);
              if (filterType && filterType !== 'all') {
                filtered = filtered.filter(e => e.type === filterType);
              }
              if (searchQuery) {
                const q = searchQuery.toLowerCase().trim();
                filtered = filtered.filter(e =>
                  (e.referenceId && e.referenceId.toLowerCase().includes(q)) ||
                  (e.description && e.description.toLowerCase().includes(q)) ||
                  (e.farmerName && e.farmerName.toLowerCase().includes(q)) ||
                  (e.remarks && e.remarks.toLowerCase().includes(q))
                );
              }

              resolve({
                entries: filtered,
                totalEntriesCount: entries.length,
                filteredCount: filtered.length,
                totalPayables: Math.round(totalPayables * 100) / 100,
                totalDeductions: Math.round(totalDeductions * 100) / 100,
                totalSettlements: Math.round(totalSettlements * 100) / 100,
                closingBalance: Math.round(runningBalance * 100) / 100
              });
            };
            farmerReq.onerror = () => reject(farmerReq.error);
          };
          settleReq.onerror = () => reject(settleReq.error);
        };
        saleReq.onerror = () => reject(saleReq.error);
      };
      liftReq.onerror = () => reject(liftReq.error);
    });
  }

  async getWangkheiStoreTransactions(startDate, endDate) {
    await this.init();
    const stores = await this.getAllStores();
    const wangkheiStoreIds = new Set(
      stores.filter(s => (s.name && s.name.toLowerCase().includes('wangkhei')) || s.isWangkhei).map(s => s.id)
    );

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sales', 'liftings', 'farmers'], 'readonly');
      const salesReq = tx.objectStore('sales').getAll();
      const liftingsReq = tx.objectStore('liftings').getAll();
      const farmersReq = tx.objectStore('farmers').getAll();

      salesReq.onsuccess = () => {
        const rawSales = salesReq.result || [];
        liftingsReq.onsuccess = () => {
          const rawLiftings = liftingsReq.result || [];
          farmersReq.onsuccess = () => {
            const rawFarmers = farmersReq.result || [];
            const liftingMap = new Map(rawLiftings.map(l => [l.id, l]));
            const farmerMap = new Map(rawFarmers.map(f => [f.id, f]));

            let items = rawSales.filter(s => wangkheiStoreIds.has(s.storeId) || s.isWangkheiSale);
            if (startDate) items = items.filter(s => s.saleDate >= startDate);
            if (endDate) items = items.filter(s => s.saleDate <= endDate);

            items.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));

            const joined = items.map(s => {
              const lifting = liftingMap.get(s.liftingId);
              const farmer = lifting ? farmerMap.get(lifting.farmerId) : null;
              return {
                saleId: s.id,
                invoiceNumber: s.invoiceNumber,
                date: s.saleDate,
                farmerId: farmer ? farmer.id : (lifting ? lifting.farmerId : ''),
                farmerName: farmer ? farmer.name : 'Unknown Farmer',
                farmerPhone: farmer ? farmer.phone : '',
                liftingId: s.liftingId,
                cageNumber: s.cageNumber,
                cagesCount: s.totalCages || (s.cages ? s.cages.length : 1),
                weight: s.weight,
                salesRate: s.salesRate,
                saleAmount: s.saleAmount,
                deductedAmount: s.saleAmount,
                remarks: s.remarks || 'Wangkhei Store bird sale',
                status: 'Deducted from Singke',
                createdAt: s.createdAt
              };
            });

            resolve(joined);
          };
          farmersReq.onerror = () => reject(farmersReq.error);
        };
        liftingsReq.onerror = () => reject(liftingsReq.error);
      };
      salesReq.onerror = () => reject(salesReq.error);
    });
  }

  async getFarmerFinancialSummary(farmerId) {
    await this.init();
    const farmer = await this.getFarmer(farmerId);
    if (!farmer) throw new Error('Farmer not found.');

    const stores = await this.getAllStores();
    const wangkheiStoreIds = new Set(
      stores.filter(s => (s.name && s.name.toLowerCase().includes('wangkhei')) || s.isWangkhei).map(s => s.id)
    );

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['liftings', 'sales', 'singke_settlements'], 'readonly');
      const liftIdx = tx.objectStore('liftings').index('by_farmerId');
      const liftReq = liftIdx.getAll(farmerId);

      liftReq.onsuccess = () => {
        const liftings = liftReq.result || [];
        const liftingIds = new Set(liftings.map(l => l.id));

        const saleReq = tx.objectStore('sales').getAll();
        saleReq.onsuccess = () => {
          const allSales = saleReq.result || [];
          const wangkheiSales = allSales.filter(s =>
            liftingIds.has(s.liftingId) && (wangkheiStoreIds.has(s.storeId) || s.isWangkheiSale)
          );

          const settleReq = tx.objectStore('singke_settlements').getAll();
          settleReq.onsuccess = () => {
            const allSettlements = settleReq.result || [];
            const farmerSettlements = allSettlements.filter(st => st.farmerId === farmerId);

            let totalBirds = 0;
            let totalWeight = 0;
            let totalCages = 0;
            let totalLiftingAmount = 0;

            const timeline = [];

            for (const l of liftings) {
              totalBirds += (l.totalBirds || 0);
              totalWeight += (l.totalWeight || 0);
              totalCages += (l.totalCages || 0);
              const rate = l.liftingRate || 0;
              const amt = l.liftingAmount !== undefined ? l.liftingAmount : Math.round((l.totalWeight * rate) * 100) / 100;
              totalLiftingAmount += amt;

              timeline.push({
                date: l.liftingDate,
                createdAt: l.createdAt || l.liftingDate,
                type: 'LIFTING',
                typeLabel: 'Lifting (Payable)',
                ref: l.id,
                details: `${l.totalWeight} kg, ${l.totalBirds} birds @ ₹${rate}/kg`,
                effect: amt,
                amount: amt,
                status: 'Payable via Singke',
                remarks: l.remarks || ''
              });
            }

            let wangkheiDeductions = 0;
            for (const s of wangkheiSales) {
              wangkheiDeductions += (s.saleAmount || 0);
              timeline.push({
                date: s.saleDate,
                createdAt: s.createdAt || s.saleDate,
                type: 'WANGKHEI_ADJUSTMENT',
                typeLabel: 'Wangkhei Store Adjustment',
                ref: s.invoiceNumber,
                details: `${s.weight} kg @ ₹${s.salesRate}/kg (Lifting: ${s.liftingId})`,
                effect: -(s.saleAmount || 0),
                amount: s.saleAmount || 0,
                status: 'Settled via Wangkhei',
                remarks: s.remarks || 'Wangkhei bird sale adjustment'
              });
            }

            let directSettlements = 0;
            for (const st of farmerSettlements) {
              directSettlements += (st.amount || 0);
              timeline.push({
                date: st.date,
                createdAt: st.createdAt || st.date,
                type: 'DIRECT_SETTLEMENT',
                typeLabel: 'Singke Settlement Payout',
                ref: st.referenceNumber || st.id,
                details: `Paid via ${st.paymentMethod}`,
                effect: -(st.amount || 0),
                amount: st.amount || 0,
                status: 'Settled',
                remarks: st.remarks || ''
              });
            }

            timeline.sort((a, b) => {
              if (a.date !== b.date) return a.date > b.date ? 1 : -1;
              return (a.createdAt || '') > (b.createdAt || '') ? 1 : -1;
            });

            let runningBalance = 0;
            for (const item of timeline) {
              runningBalance += item.effect;
              item.runningBalance = Math.round(runningBalance * 100) / 100;
            }

            const totalSettled = wangkheiDeductions + directSettlements;
            const remainingDue = totalLiftingAmount - totalSettled;

            resolve({
              farmer,
              totalLiftings: liftings.length,
              totalBirds,
              totalWeight: Math.round(totalWeight * 100) / 100,
              totalCages,
              totalLiftingAmount: Math.round(totalLiftingAmount * 100) / 100,
              wangkheiDeductions: Math.round(wangkheiDeductions * 100) / 100,
              directSettlements: Math.round(directSettlements * 100) / 100,
              totalSettled: Math.round(totalSettled * 100) / 100,
              remainingDue: Math.round(remainingDue * 100) / 100,
              timeline
            });
          };
          settleReq.onerror = () => reject(settleReq.error);
        };
        saleReq.onerror = () => reject(saleReq.error);
      };
      liftReq.onerror = () => reject(liftReq.error);
    });
  }

  async getFarmerPaymentReport(startDate, endDate, searchQuery = '', page = 1, pageSize = 50) {
    await this.init();
    const stores = await this.getAllStores();
    const wangkheiStoreIds = new Set(
      stores.filter(s => (s.name && s.name.toLowerCase().includes('wangkhei')) || s.isWangkhei).map(s => s.id)
    );

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['farmers', 'liftings', 'sales', 'singke_settlements'], 'readonly');
      const farmerReq = tx.objectStore('farmers').getAll();
      const liftReq = tx.objectStore('liftings').getAll();
      const saleReq = tx.objectStore('sales').getAll();
      const settleReq = tx.objectStore('singke_settlements').getAll();

      farmerReq.onsuccess = () => {
        const farmers = farmerReq.result || [];
        liftReq.onsuccess = () => {
          let liftings = liftReq.result || [];
          if (startDate) liftings = liftings.filter(l => l.liftingDate >= startDate);
          if (endDate) liftings = liftings.filter(l => l.liftingDate <= endDate);

          saleReq.onsuccess = () => {
            let sales = (saleReq.result || []).filter(s => wangkheiStoreIds.has(s.storeId) || s.isWangkheiSale);
            if (startDate) sales = sales.filter(s => s.saleDate >= startDate);
            if (endDate) sales = sales.filter(s => s.saleDate <= endDate);

            settleReq.onsuccess = () => {
              let settlements = settleReq.result || [];
              if (startDate) settlements = settlements.filter(s => s.date >= startDate);
              if (endDate) settlements = settlements.filter(s => s.date <= endDate);

              const farmerLiftingsMap = new Map();
              const liftingFarmerMap = new Map();
              for (const l of liftings) {
                liftingFarmerMap.set(l.id, l.farmerId);
                if (!farmerLiftingsMap.has(l.farmerId)) {
                  farmerLiftingsMap.set(l.farmerId, []);
                }
                farmerLiftingsMap.get(l.farmerId).push(l);
              }

              const farmerWangkheiMap = new Map();
              for (const s of sales) {
                const farmerId = liftingFarmerMap.get(s.liftingId);
                if (farmerId) {
                  farmerWangkheiMap.set(farmerId, (farmerWangkheiMap.get(farmerId) || 0) + (s.saleAmount || 0));
                }
              }

              const farmerSettlementsMap = new Map();
              for (const st of settlements) {
                if (st.farmerId) {
                  farmerSettlementsMap.set(st.farmerId, (farmerSettlementsMap.get(st.farmerId) || 0) + (st.amount || 0));
                }
              }

              let globalLiftingAmount = 0;
              let globalLiftingWeight = 0;
              let globalLiftingBirds = 0;
              let globalSettled = 0;
              let globalRemaining = 0;

              const reportItems = [];

              for (const f of farmers) {
                const fLiftings = farmerLiftingsMap.get(f.id) || [];
                let fBirds = 0;
                let fWeight = 0;
                let fLiftingAmount = 0;

                for (const l of fLiftings) {
                  fBirds += (l.totalBirds || 0);
                  fWeight += (l.totalWeight || 0);
                  const rate = l.liftingRate || 0;
                  const amt = l.liftingAmount !== undefined ? l.liftingAmount : Math.round((l.totalWeight * rate) * 100) / 100;
                  fLiftingAmount += amt;
                }

                const wangkheiAdj = farmerWangkheiMap.get(f.id) || 0;
                const directSettled = farmerSettlementsMap.get(f.id) || 0;
                const totalSettled = wangkheiAdj + directSettled;
                const remainingDue = fLiftingAmount - totalSettled;

                globalLiftingAmount += fLiftingAmount;
                globalLiftingWeight += fWeight;
                globalLiftingBirds += fBirds;
                globalSettled += totalSettled;
                globalRemaining += remainingDue;

                reportItems.push({
                  farmerId: f.id,
                  farmerName: f.name,
                  farmerPhone: f.phone,
                  liftingsCount: fLiftings.length,
                  totalBirds: fBirds,
                  totalWeight: Math.round(fWeight * 100) / 100,
                  totalLiftingAmount: Math.round(fLiftingAmount * 100) / 100,
                  wangkheiAdjustment: Math.round(wangkheiAdj * 100) / 100,
                  directSettlement: Math.round(directSettled * 100) / 100,
                  totalSettled: Math.round(totalSettled * 100) / 100,
                  remainingDue: Math.round(remainingDue * 100) / 100
                });
              }

              let filtered = reportItems;
              if (searchQuery) {
                const q = searchQuery.toLowerCase().trim();
                filtered = filtered.filter(item =>
                  item.farmerName.toLowerCase().includes(q) ||
                  item.farmerPhone.toLowerCase().includes(q) ||
                  item.farmerId.toLowerCase().includes(q)
                );
              }

              filtered.sort((a, b) => (b.remainingDue - a.remainingDue) || (b.totalLiftingAmount - a.totalLiftingAmount));

              const totalRecords = filtered.length;
              const skip = (page - 1) * pageSize;
              const pagedItems = filtered.slice(skip, skip + pageSize);

              resolve({
                items: pagedItems,
                totalRecords,
                page,
                pageSize,
                hasMore: totalRecords > page * pageSize,
                summary: {
                  totalFarmers: farmers.length,
                  activeFarmersCount: reportItems.filter(i => i.liftingsCount > 0).length,
                  globalLiftingWeight: Math.round(globalLiftingWeight * 100) / 100,
                  globalLiftingBirds,
                  globalLiftingAmount: Math.round(globalLiftingAmount * 100) / 100,
                  globalSettled: Math.round(globalSettled * 100) / 100,
                  globalRemaining: Math.round(globalRemaining * 100) / 100
                }
              });
            };
            settleReq.onerror = () => reject(settleReq.error);
          };
          saleReq.onerror = () => reject(saleReq.error);
        };
        liftReq.onerror = () => reject(liftReq.error);
      };
      farmerReq.onerror = () => reject(farmerReq.error);
    });
  }

  // --- BACKUP & RESTORE & EXCEL EXPORT ---
  async exportFullDatabaseJSON() {
    await this.init();
    const stores = ['farmers', 'liftings', 'cages', 'stores', 'sales', 'payments', 'settings', 'singke_settlements'];
    const exportData = {
      app: 'MPF LiftDesk',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      data: {}
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readonly');
      let completed = 0;

      for (const storeName of stores) {
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => {
          exportData.data[storeName] = req.result;
          completed++;
          if (completed === stores.length) {
            resolve(exportData);
          }
        };
        req.onerror = () => reject(req.error);
      }
    });
  }

  async restoreFullDatabaseJSON(backupObj) {
    if (!backupObj || !backupObj.data || backupObj.app !== 'MPF LiftDesk') {
      throw new Error('Invalid backup file. Must be a valid MPF LiftDesk backup JSON.');
    }

    await this.init();
    const stores = ['farmers', 'liftings', 'cages', 'stores', 'sales', 'payments', 'settings', 'singke_settlements'];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');

      for (const storeName of stores) {
        const store = tx.objectStore(storeName);
        store.clear();
        const records = backupObj.data[storeName] || [];
        for (const item of records) {
          store.put(item);
        }
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAllData() {
    await this.init();
    const stores = ['farmers', 'liftings', 'cages', 'stores', 'sales', 'payments', 'settings', 'singke_settlements'];
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      for (const storeName of stores) {
        tx.objectStore(storeName).clear();
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- SETTINGS (PIN Lock, etc.) ---
  async getSetting(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  async setSetting(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const req = tx.objectStore('settings').put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

// Global Database Instance
window.liftDeskDB = new LiftDeskDatabase();
