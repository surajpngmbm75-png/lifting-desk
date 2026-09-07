/**
 * MPF LiftDesk - Broiler Lifting & Store Supply Management
 * Primary Application Controller
 */

(function () {
  'use strict';

  // --- APPLICATION STATE ---
  const state = {
    currentView: 'viewHome',
    selectedFarmerForLifting: null,
    currentLiftingCages: [], // Array of { cageNumber, weight, birdCount }
    saleAvailableCages: [], // Array of cage records available in selected lifting
    saleSelectedCages: [],  // Array of { cageId, cageNumber, birdCount, originalWeight, weight }
    farmerSearchQuery: '',
    farmerPage: 1,
    farmerPageSize: 15,
    pinHash: null,
    pinLocked: false,
    enteredPin: '',
    dashLiftingFilter: {
      startDate: '',
      endDate: '',
      preset: 'today'
    },
    singkeFilter: {
      startDate: '',
      endDate: '',
      preset: 'all',
      activeTab: 'summary',
      ledgerType: 'all',
      ledgerSearch: '',
      farmerSearch: ''
    }
  };

  // --- NATIVE BRIDGE HELPER ---
  const Native = {
    showToast(msg) {
      if (window.AndroidNativeBridge && typeof window.AndroidNativeBridge.showToast === 'function') {
        try { window.AndroidNativeBridge.showToast(msg); } catch (e) { console.warn(e); }
      }
      showInAppToast(msg);
    },

    print() {
      if (window.AndroidNativeBridge && typeof window.AndroidNativeBridge.printDocument === 'function') {
        try {
          window.AndroidNativeBridge.printDocument();
          return;
        } catch (e) { console.warn(e); }
      }
      window.print();
    },

    openWhatsApp(phone, text) {
      const cleanPhone = (phone || '').replace(/\D/g, '');
      if (window.AndroidNativeBridge && typeof window.AndroidNativeBridge.openWhatsApp === 'function') {
        try {
          window.AndroidNativeBridge.openWhatsApp(cleanPhone, text);
          return;
        } catch (e) { console.warn(e); }
      }
      const url = `https://api.whatsapp.com/send?phone=${encodeURIComponent(cleanPhone)}&text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    }
  };

  // Toast UI
  function showInAppToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }

  // Formatting helpers
  function formatCurrency(amount) {
    const n = parseFloat(amount) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatKg(weight) {
    const n = parseFloat(weight) || 0;
    return n.toFixed(2);
  }

  function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getDateOffsetString(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getFirstDayOfMonthString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }

  // --- ROUTING / VIEW NAVIGATION ---
  function navigateTo(viewId) {
    try {
      const views = document.querySelectorAll('.view-section');
      views.forEach(v => v.classList.remove('active'));

      const targetView = document.getElementById(viewId);
      if (targetView) {
        targetView.classList.add('active');
        state.currentView = viewId;
      }

      const navItems = document.querySelectorAll('.nav-item');
      navItems.forEach(item => {
        if (item.dataset.view === viewId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Refresh view specific data safely
      if (viewId === 'viewHome') loadDashboard();
      else if (viewId === 'viewLifting') loadLiftingView();
      else if (viewId === 'viewFarmers') loadFarmersList();
      else if (viewId === 'viewSales') loadSalesView();
      else if (viewId === 'viewStores') loadStoresList();
      else if (viewId === 'viewLedger') loadLedgerView();
      else if (viewId === 'viewSingkeAccount') loadSingkeAccountView();
      else if (viewId === 'viewReports') loadAccountingView();
      else if (viewId === 'viewSettings') loadSettingsView();
    } catch (e) {
      console.error('View switch error for ' + viewId, e);
    }
  }
  window.navigateTo = navigateTo;

  // --- ANDROID HARDWARE BACK NAVIGATION ---
  window.handleAndroidBack = function() {
    // 1. Close any open modal
    const activeModal = document.querySelector('.modal-backdrop.active');
    if (activeModal) {
      activeModal.classList.remove('active');
      return 'HANDLED';
    }

    // 2. If app is locked, stay locked
    if (state.pinLocked) {
      return 'HANDLED';
    }

    // 3. If on a sub-view, go back to Home
    if (state.currentView && state.currentView !== 'viewHome') {
      navigateTo('viewHome');
      return 'HANDLED';
    }

    // 4. On Home with no modals -> exit app
    return 'EXIT';
  };

  // --- MODALS HELPER ---
  function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('active');
  }

  function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('active');
  }

  function showIntegrityAlert(message) {
    const msgEl = document.getElementById('integrityAlertMessage');
    if (msgEl) msgEl.textContent = message;
    openModal('modalIntegrityAlert');
  }

  // --- CLOCK & LIVE DATE ---
  function startClock() {
    function update() {
      const now = new Date();
      const timeEl = document.getElementById('headerTime');
      const dateEl = document.getElementById('headerDate');
      const settingsTime = document.getElementById('settingsDeviceTime');

      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

      if (timeEl) timeEl.textContent = timeStr;
      if (dateEl) dateEl.textContent = dateStr;
      if (settingsTime) settingsTime.textContent = `${dateStr} ${timeStr}`;
    }
    update();
    setInterval(update, 1000);
  }

  function getDashboardRangeLabel(preset, startDate, endDate, today) {
    if (preset === 'today' || (startDate === today && endDate === today)) {
      return 'Today';
    } else if (preset === 'yesterday' || (startDate === getDateOffsetString(-1) && endDate === getDateOffsetString(-1))) {
      return 'Yesterday';
    } else if (preset === 'last7') {
      return 'Last 7 Days';
    } else if (preset === 'thisMonth') {
      return 'This Month';
    } else if (preset === 'all' || (!startDate && !endDate)) {
      return 'All Time';
    } else if (startDate && endDate && startDate === endDate) {
      return startDate;
    } else if (startDate && endDate) {
      return `${startDate} to ${endDate}`;
    } else if (startDate) {
      return `From ${startDate}`;
    } else if (endDate) {
      return `Up to ${endDate}`;
    }
    return 'Custom';
  }

  // --- 1. HOME / DASHBOARD CONTROLLER ---
  async function loadDashboard() {
    try {
      const today = getTodayString();
      if (!state.dashLiftingFilter) {
        state.dashLiftingFilter = {
          startDate: today,
          endDate: today,
          preset: 'today'
        };
      } else if (!state.dashLiftingFilter.startDate && !state.dashLiftingFilter.endDate && state.dashLiftingFilter.preset === 'today') {
        state.dashLiftingFilter.startDate = today;
        state.dashLiftingFilter.endDate = today;
      }

      const { startDate, endDate, preset } = state.dashLiftingFilter;

      // Sync filter UI inputs
      const startInput = document.getElementById('dashFilterStartDate');
      const endInput = document.getElementById('dashFilterEndDate');
      if (startInput && startInput.value !== (startDate || '')) startInput.value = startDate || '';
      if (endInput && endInput.value !== (endDate || '')) endInput.value = endDate || '';

      // Sync preset chips active class
      document.querySelectorAll('.dash-filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.preset === preset);
      });

      const rangeLabel = getDashboardRangeLabel(preset, startDate, endDate, today);

      // Fetch dynamic date-filtered metrics from database
      const data = await window.liftDeskDB.getDashboardData(startDate, endDate);
      const stats = data.rangeStats || data.todayStats || {};
      const isAllTime = (preset === 'all' || (!startDate && !endDate));

      // 1. Update Card 1: Cages Lifted
      const labelCages = document.getElementById('dashLabelCages');
      const valCages = document.getElementById('dashTodayCages');
      const subCages = document.getElementById('dashSubCages');
      if (labelCages) labelCages.textContent = `Cages Lifted (${rangeLabel})`;
      if (valCages) valCages.textContent = stats.cagesLifted || 0;
      if (subCages) {
        const birds = stats.totalBirds || 0;
        const liftingsCount = data.rangeLiftingsCount || data.todayLiftingsCount || 0;
        subCages.textContent = `${birds} birds (${liftingsCount} ${liftingsCount === 1 ? 'lifting' : 'liftings'})`;
      }

      // 2. Update Card 2: Total Weight
      const labelWeight = document.getElementById('dashLabelWeight');
      const valWeight = document.getElementById('dashTodayWeight');
      const subWeight = document.getElementById('dashSubWeight');
      if (labelWeight) labelWeight.textContent = `Total Weight (${rangeLabel})`;
      if (valWeight) valWeight.textContent = formatKg(stats.totalWeight || 0);
      if (subWeight) {
        const avg = (stats.totalBirds && stats.totalBirds > 0) ? (stats.totalWeight / stats.totalBirds).toFixed(2) : '0.00';
        subWeight.textContent = `Live bird avg: ${avg} kg/bird`;
      }

      // 3. Update Card 3: Sales
      const labelSales = document.getElementById('dashLabelSales');
      const valSales = document.getElementById('dashTodaySales');
      const subSales = document.getElementById('dashSubSales');
      if (labelSales) labelSales.textContent = `Sales (${rangeLabel})`;
      if (valSales) valSales.textContent = formatCurrency(stats.salesAmount || 0);
      if (subSales) {
        subSales.textContent = `Collections: ₹${formatCurrency(stats.collectedAmount || 0)}`;
      }

      // 4. Update Card 4: Store Outstanding
      const labelOut = document.getElementById('dashLabelOutstanding');
      const valOut = document.getElementById('dashStoreOutstanding');
      const subOut = document.getElementById('dashSubOutstanding');
      if (labelOut) {
        labelOut.textContent = isAllTime ? 'Store Outstanding' : `Period Outstanding (${rangeLabel})`;
      }
      if (valOut) {
        const displayOutstanding = isAllTime ? (stats.totalStoreOutstanding || 0) : (stats.periodOutstanding || 0);
        valOut.textContent = formatCurrency(displayOutstanding);
      }
      if (subOut) {
        subOut.textContent = isAllTime
          ? 'Total receivables across stores'
          : `Net due (Total store debt: ₹${formatCurrency(stats.totalStoreOutstanding || 0)})`;
      }

      // 5. Update Filter Summary Strip
      const sumRangeEl = document.getElementById('dashSumRange');
      const sumCagesEl = document.getElementById('dashSumCages');
      const sumWeightEl = document.getElementById('dashSumWeight');
      const sumSalesEl = document.getElementById('dashSumSales');
      const sumOutEl = document.getElementById('dashSumOutstanding');

      if (sumRangeEl) sumRangeEl.textContent = rangeLabel;
      if (sumCagesEl) sumCagesEl.textContent = stats.cagesLifted || 0;
      if (sumWeightEl) sumWeightEl.textContent = formatKg(stats.totalWeight || 0);
      if (sumSalesEl) sumSalesEl.textContent = `₹${formatCurrency(stats.salesAmount || 0)}`;
      if (sumOutEl) {
        const displayOutstanding = isAllTime ? (stats.totalStoreOutstanding || 0) : (stats.periodOutstanding || 0);
        sumOutEl.textContent = `₹${formatCurrency(displayOutstanding)}`;
      }

      // 6. Reconciliation & Velocity
      if (data.reconciliation) {
        const totalCages = data.reconciliation.totalLiftedCages || 0;
        const soldCages = data.reconciliation.soldCages || 0;
        const remainingCages = data.reconciliation.remainingCages || 0;
        const remainingWeight = data.reconciliation.remainingWeight || 0;

        const reconTotal = document.getElementById('reconTotalCages');
        const reconSold = document.getElementById('reconSoldCages');
        const reconRem = document.getElementById('reconRemainingCages');
        const reconWeight = document.getElementById('reconRemainingWeight');

        if (reconTotal) reconTotal.textContent = totalCages;
        if (reconSold) reconSold.textContent = soldCages;
        if (reconRem) reconRem.textContent = remainingCages;
        if (reconWeight) reconWeight.textContent = formatKg(remainingWeight);

        const velocityPct = totalCages > 0 ? Math.min(100, Math.round((soldCages / totalCages) * 100)) : 0;
        const veloText = document.getElementById('dashSalesVelocityText');
        const veloFill = document.getElementById('dashSalesVelocityFill');
        if (veloText) veloText.textContent = `${velocityPct}% Sold`;
        if (veloFill) veloFill.style.width = `${velocityPct}%`;
      }

      // 7. Load activity table for the selected range
      await loadDashboardLiftingActivity(rangeLabel);

      // 8. Update Singke & Wangkhei Accounting Dashboard Overview
      try {
        const singkeFin = await window.liftDeskDB.getSingkeAccountSummary();
        const remEl = document.getElementById('dashSingkeRemainingDue');
        const payEl = document.getElementById('dashSingkePayable');
        const wangEl = document.getElementById('dashSingkeWangkhei');
        const setEl = document.getElementById('dashSingkeSettlements');

        if (remEl) remEl.textContent = formatCurrency(singkeFin.remainingDueToSingke);
        if (payEl) payEl.textContent = formatCurrency(singkeFin.totalPayableToSingke);
        if (wangEl) wangEl.textContent = formatCurrency(singkeFin.totalWangkheiDeductions);
        if (setEl) setEl.textContent = formatCurrency(singkeFin.totalOtherSettlements);
      } catch (errSingke) {
        console.warn('Error fetching Singke dashboard stats:', errSingke);
      }
    } catch (err) {
      console.error('Error loading dashboard:', err);
    }
  }

  async function loadDashboardLiftingActivity(rangeLabelParam) {
    try {
      const today = getTodayString();
      const { startDate, endDate, preset } = state.dashLiftingFilter;
      const rangeLabel = rangeLabelParam || getDashboardRangeLabel(preset, startDate, endDate, today);

      const headingEl = document.getElementById('dashActivityHeading');
      if (headingEl) {
        headingEl.textContent = `Lifting Activity (${rangeLabel})`;
      }

      // Query database for liftings in date range
      const filteredLiftings = await window.liftDeskDB.getLiftingsByDateRange(startDate, endDate);

      const tbody = document.getElementById('dashActivityTbody');
      const empty = document.getElementById('dashActivityEmpty');
      const emptyTitle = document.getElementById('dashActivityEmptyTitle');
      const emptyDesc = document.getElementById('dashActivityEmptyDesc');
      const countBadge = document.getElementById('dashTodayCountBadge');

      if (countBadge) {
        countBadge.textContent = `${filteredLiftings.length} ${filteredLiftings.length === 1 ? 'record' : 'records'}`;
      }

      if (!tbody) return;
      tbody.innerHTML = '';

      if (filteredLiftings.length === 0) {
        if (empty) empty.style.display = 'block';
        if (emptyTitle) {
          emptyTitle.textContent = rangeLabel === 'Today' ? 'No liftings recorded today' : `No liftings found for ${rangeLabel}`;
        }
        if (emptyDesc) {
          emptyDesc.textContent = rangeLabel === 'Today'
            ? 'Tap "New Lifting" to record your first broiler lifting of the day.'
            : 'Try adjusting the date range or select a preset to view activity.';
        }
      } else {
        if (empty) empty.style.display = 'none';
        filteredLiftings.forEach(l => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><span class="badge" style="font-size:11px;font-family:monospace;background:#F1F5F9;color:#334155;">${l.liftingDate || ''}</span></td>
            <td><strong>${l.id}</strong></td>
            <td><strong>${escapeHtml(l.farmerName)}</strong></td>
            <td>${l.totalCages} cages</td>
            <td><strong>${formatKg(l.totalWeight)} kg</strong></td>
            <td>${l.totalBirds} birds</td>
            <td>
              <button class="btn btn-outline btn-sm" onclick="window.viewFarmerReport('${l.farmerId}')">Farmer</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (err) {
      console.error('Error loading dashboard lifting activity:', err);
    }
  }

  function initDashboardActivityFilter() {
    const today = getTodayString();
    state.dashLiftingFilter = {
      startDate: today,
      endDate: today,
      preset: 'today'
    };

    const startInput = document.getElementById('dashFilterStartDate');
    const endInput = document.getElementById('dashFilterEndDate');
    if (startInput) startInput.value = today;
    if (endInput) endInput.value = today;

    // Presets
    document.querySelectorAll('.dash-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        state.dashLiftingFilter.preset = preset;

        if (preset === 'today') {
          state.dashLiftingFilter.startDate = getTodayString();
          state.dashLiftingFilter.endDate = getTodayString();
        } else if (preset === 'yesterday') {
          const y = getDateOffsetString(-1);
          state.dashLiftingFilter.startDate = y;
          state.dashLiftingFilter.endDate = y;
        } else if (preset === 'last7') {
          state.dashLiftingFilter.startDate = getDateOffsetString(-6);
          state.dashLiftingFilter.endDate = getTodayString();
        } else if (preset === 'thisMonth') {
          state.dashLiftingFilter.startDate = getFirstDayOfMonthString();
          state.dashLiftingFilter.endDate = getTodayString();
        } else if (preset === 'all') {
          state.dashLiftingFilter.startDate = '';
          state.dashLiftingFilter.endDate = '';
        }

        if (startInput) startInput.value = state.dashLiftingFilter.startDate;
        if (endInput) endInput.value = state.dashLiftingFilter.endDate;

        loadDashboard();
      });
    });

    // Apply button
    const applyBtn = document.getElementById('dashFilterApplyBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const sVal = startInput ? startInput.value : '';
        const eVal = endInput ? endInput.value : '';
        state.dashLiftingFilter.startDate = sVal;
        state.dashLiftingFilter.endDate = eVal;
        state.dashLiftingFilter.preset = 'custom';
        loadDashboard();
      });
    }

    // Reset button
    const resetBtn = document.getElementById('dashFilterResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const curToday = getTodayString();
        state.dashLiftingFilter = {
          startDate: curToday,
          endDate: curToday,
          preset: 'today'
        };
        if (startInput) startInput.value = curToday;
        if (endInput) endInput.value = curToday;
        loadDashboard();
      });
    }

    // Input changes
    if (startInput) {
      startInput.addEventListener('change', () => {
        state.dashLiftingFilter.startDate = startInput.value;
        state.dashLiftingFilter.preset = 'custom';
        loadDashboard();
      });
    }
    if (endInput) {
      endInput.addEventListener('change', () => {
        state.dashLiftingFilter.endDate = endInput.value;
        state.dashLiftingFilter.preset = 'custom';
        loadDashboard();
      });
    }
  }

  // --- 2. LIFTING MODULE CONTROLLER ---
  function loadLiftingView() {
    const dateInput = document.getElementById('inputLiftingDate');
    if (!dateInput.value) {
      dateInput.value = getTodayString();
    }
    updateLiftingFarmerUI();
    renderCurrentCagesList();
    loadLiftingHistory();
  }

  function updateLiftingFarmerUI() {
    const displayBox = document.getElementById('liftingFarmerDisplay');
    const selectBox = document.getElementById('liftingFarmerSelectBox');

    if (state.selectedFarmerForLifting) {
      displayBox.style.display = 'flex';
      selectBox.style.display = 'none';
      document.getElementById('selectedFarmerName').textContent = state.selectedFarmerForLifting.name;
      document.getElementById('selectedFarmerId').textContent = state.selectedFarmerForLifting.id;
      document.getElementById('selectedFarmerPhone').textContent = state.selectedFarmerForLifting.phone;
    } else {
      displayBox.style.display = 'none';
      selectBox.style.display = 'block';
    }
  }

  function renderCurrentCagesList() {
    const container = document.getElementById('cagesRowsList');
    const emptyPrompt = document.getElementById('cagesEmptyPrompt');
    container.innerHTML = '';

    const cages = state.currentLiftingCages;

    let totalWeight = 0;
    let totalBirds = 0;

    if (cages.length === 0) {
      emptyPrompt.style.display = 'block';
    } else {
      emptyPrompt.style.display = 'none';
      cages.forEach((c, idx) => {
        totalWeight += c.weight;
        totalBirds += c.birdCount;

        const row = document.createElement('div');
        row.className = 'cage-row-item';
        row.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="cage-tag">Cage ${escapeHtml(c.cageNumber)}</span>
          </div>
          <div class="cage-metrics">
            <span>${formatKg(c.weight)} kg</span>
            <span>(${c.birdCount} birds)</span>
          </div>
          <button type="button" class="btn btn-outline btn-sm" style="color:var(--danger);padding:2px 8px;min-height:28px;" onclick="window.removeCageFromCurrentLifting(${idx})">
            ✕
          </button>
        `;
        container.appendChild(row);
      });
    }

    document.getElementById('summaryCageCount').textContent = cages.length;
    document.getElementById('summaryTotalWeight').textContent = formatKg(totalWeight);
    document.getElementById('summaryTotalBirds').textContent = totalBirds;
    const avg = totalBirds > 0 ? (totalWeight / totalBirds) : 0;
    document.getElementById('summaryAvgBirdWeight').textContent = formatKg(avg);

    // Live Total Amount calculation based on lifting rate
    const rateInput = document.getElementById('inputLiftingRate');
    const rate = rateInput ? (parseFloat(rateInput.value) || 0) : 0;
    const totalAmount = Math.round(totalWeight * rate * 100) / 100;
    const sumAmountEl = document.getElementById('summaryTotalAmount');
    if (sumAmountEl) sumAmountEl.textContent = formatCurrency(totalAmount);
  }

  window.removeCageFromCurrentLifting = function (index) {
    state.currentLiftingCages.splice(index, 1);
    renderCurrentCagesList();
  };

  async function addCageToCurrentLifting() {
    const cageNumInput = document.getElementById('inputCageNumber');
    const weightInput = document.getElementById('inputCageWeight');
    const birdsInput = document.getElementById('inputCageBirds');

    const cageNumber = cageNumInput.value.trim();
    const weight = parseFloat(weightInput.value);
    const birdCount = parseInt(birdsInput.value, 10);

    if (!cageNumber) {
      Native.showToast('Please enter a cage number (e.g. C-1)');
      cageNumInput.focus();
      return;
    }

    // Check duplicate cage number within the current lifting
    const exists = state.currentLiftingCages.some(c => c.cageNumber.toLowerCase() === cageNumber.toLowerCase());
    if (exists) {
      Native.showToast(`Cage "${cageNumber}" already added to this lifting! Use a unique cage number.`);
      cageNumInput.focus();
      return;
    }

    if (isNaN(weight) || weight <= 0) {
      Native.showToast('Please enter a valid bird weight (greater than 0)');
      weightInput.focus();
      return;
    }

    if (isNaN(birdCount) || birdCount <= 0) {
      Native.showToast('Please enter a valid bird count (at least 1)');
      birdsInput.focus();
      return;
    }

    state.currentLiftingCages.push({
      cageNumber,
      weight,
      birdCount
    });

    // Reset cage inputs and suggest next cage number if sequential
    weightInput.value = '';
    birdsInput.value = '';
    const match = cageNumber.match(/^([A-Za-z]*-?)(\d+)$/);
    if (match) {
      const nextNum = parseInt(match[2], 10) + 1;
      cageNumInput.value = `${match[1]}${nextNum}`;
    } else {
      cageNumInput.value = '';
    }
    cageNumInput.focus();

    renderCurrentCagesList();
  }

  async function saveCurrentLifting() {
    if (!state.selectedFarmerForLifting) {
      Native.showToast('Please select a farmer from Farmer Master.');
      openFarmerSelectorDialog();
      return;
    }

    const date = document.getElementById('inputLiftingDate').value;
    if (!date) {
      Native.showToast('Please specify the lifting date.');
      return;
    }

    if (state.currentLiftingCages.length === 0) {
      Native.showToast('Please add at least one cage to this lifting.');
      return;
    }

    const liftingRate = parseFloat(document.getElementById('inputLiftingRate').value) || 0;
    const remarks = (document.getElementById('inputLiftingRemarks').value || '').trim();

    try {
      const liftingData = {
        farmerId: state.selectedFarmerForLifting.id,
        liftingDate: date,
        liftingRate: liftingRate,
        remarks: remarks
      };

      const result = await window.liftDeskDB.saveLiftingWithCages(liftingData, state.currentLiftingCages);
      Native.showToast(`Lifting ${result.lifting.id} saved successfully! Payable to Singke: ₹${formatCurrency(result.lifting.liftingAmount)}`);

      // Reset form
      resetLiftingForm();
      // Refresh history
      loadLiftingHistory();
      loadDashboard();
    } catch (err) {
      console.error(err);
      Native.showToast(`Failed to save lifting: ${err.message}`);
    }
  }

  function resetLiftingForm() {
    state.selectedFarmerForLifting = null;
    state.currentLiftingCages = [];
    document.getElementById('inputLiftingDate').value = getTodayString();
    document.getElementById('inputLiftingRate').value = '';
    document.getElementById('inputLiftingRemarks').value = '';
    document.getElementById('inputCageNumber').value = '';
    document.getElementById('inputCageWeight').value = '';
    document.getElementById('inputCageBirds').value = '';
    updateLiftingFarmerUI();
    renderCurrentCagesList();
  }

  async function loadLiftingHistory() {
    try {
      const data = await window.liftDeskDB.getLiftings(1, 20);
      const tbody = document.getElementById('liftingHistoryTbody');
      const empty = document.getElementById('liftingHistoryEmpty');
      const badge = document.getElementById('liftingHistoryCountBadge');

      tbody.innerHTML = '';
      badge.textContent = `${data.total} total liftings`;

      if (data.items.length === 0) {
        empty.style.display = 'block';
      } else {
        empty.style.display = 'none';
        data.items.forEach(l => {
          const liftingVal = l.liftingAmount !== undefined ? l.liftingAmount : (l.totalWeight * (l.liftingRate || 0));
          const rateVal = l.liftingRate || 0;
          const remarksText = l.remarks ? escapeHtml(l.remarks) : '<span style="color:var(--text-muted);">--</span>';

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${l.id}</strong></td>
            <td>${l.liftingDate}</td>
            <td><strong>${escapeHtml(l.farmerName)}</strong></td>
            <td>${l.totalCages}</td>
            <td><strong>${formatKg(l.totalWeight)} kg</strong></td>
            <td>${l.totalBirds}</td>
            <td>₹${formatCurrency(rateVal)}</td>
            <td style="font-weight:700;color:#1E40AF;">₹${formatCurrency(liftingVal)}</td>
            <td>${remarksText}</td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="btn btn-outline btn-sm" onclick="window.openEditLiftingRateModal('${l.id}')" title="Edit Rate or Remarks">Edit</button>
                <button class="btn btn-outline btn-sm" onclick="window.viewFarmerAccountingStatement('${l.farmerId}')" title="View Statement">A/C</button>
                <button class="btn btn-danger btn-sm" onclick="window.confirmDeleteLifting('${l.id}')">Delete</button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  window.confirmDeleteLifting = async function (liftingId) {
    try {
      const check = await window.liftDeskDB.canDeleteLifting(liftingId);
      if (!check.canDelete) {
        showIntegrityAlert(check.reason);
        return;
      }

      if (confirm(`Are you sure you want to permanently delete Lifting ${liftingId} and its cages?`)) {
        await window.liftDeskDB.deleteLifting(liftingId);
        Native.showToast(`Lifting ${liftingId} deleted successfully.`);
        loadLiftingHistory();
        loadDashboard();
      }
    } catch (err) {
      showIntegrityAlert(err.message);
    }
  };

  // --- 3. FARMER MASTER CONTROLLER ---
  // Authoritative single source of truth
  async function loadFarmersList() {
    try {
      const query = state.farmerSearchQuery;
      const res = await window.liftDeskDB.searchFarmers(query, state.farmerPage, state.farmerPageSize);

      const countEl = document.getElementById('farmerSearchResultsCount');
      const statusEl = document.getElementById('farmerSearchStatus');
      const container = document.getElementById('farmersListContainer');
      const empty = document.getElementById('farmersEmptyState');
      const pagination = document.getElementById('farmerPagination');

      countEl.textContent = `${res.total} Registered Farmers`;
      statusEl.textContent = query ? `Showing matches for "${query}"` : 'Indexed by Name & Phone';

      container.innerHTML = '';

      if (res.items.length === 0) {
        empty.style.display = 'block';
        pagination.style.display = 'none';
      } else {
        empty.style.display = 'none';
        pagination.style.display = res.total > state.farmerPageSize ? 'flex' : 'none';
        document.getElementById('farmerPageIndicator').textContent = `Page ${state.farmerPage} of ${Math.ceil(res.total / state.farmerPageSize) || 1}`;

        // Fetch metrics for displayed farmers
        for (const farmer of res.items) {
          const liftings = await window.liftDeskDB.getLiftingsByFarmer(farmer.id);
          let totalWeight = 0;
          let totalCages = 0;
          for (const l of liftings) {
            totalWeight += (l.totalWeight || 0);
            totalCages += (l.totalCages || 0);
          }

          const fin = await window.liftDeskDB.getFarmerFinancialSummary(farmer.id);

          const card = document.createElement('div');
          card.className = 'farmer-card';
          card.innerHTML = `
            <div class="farmer-card-header">
              <div class="farmer-name">${escapeHtml(farmer.name)}</div>
              <div class="farmer-id-badge">${farmer.id}</div>
            </div>
            <div class="farmer-phone-row">
              <span>📞 ${escapeHtml(farmer.phone)}</span>
            </div>
            <div class="farmer-stats-strip">
              <div class="farmer-stat-item">
                <span style="color:var(--text-muted);font-size:11px;">Liftings</span>
                <strong>${liftings.length}</strong>
              </div>
              <div class="farmer-stat-item">
                <span style="color:var(--text-muted);font-size:11px;">Total Weight</span>
                <strong>${formatKg(totalWeight)} kg</strong>
              </div>
              <div class="farmer-stat-item">
                <span style="color:var(--text-muted);font-size:11px;">Lifting Value</span>
                <strong style="color:#1E40AF;">₹${formatCurrency(fin.totalLiftingAmount)}</strong>
              </div>
              <div class="farmer-stat-item">
                <span style="color:var(--text-muted);font-size:11px;">Remaining Due</span>
                <strong style="color:${fin.remainingDue > 0 ? '#DC2626' : '#16A34A'};">₹${formatCurrency(fin.remainingDue)}</strong>
              </div>
            </div>
            <div class="farmer-actions">
              <!-- PROMINENT NEW LIFTING BUTTON (1-CLICK ENTRY) -->
              <button type="button" class="btn btn-sm btn-new-lifting-primary" onclick="window.startLiftingForFarmer('${farmer.id}')">
                📦 + New Lifting
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.viewFarmerAccountingStatement('${farmer.id}')" title="Full Financial & Singke Settlement Statement">
                A/C Statement
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.viewFarmerReport('${farmer.id}')">
                Lifting Log
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.editFarmer('${farmer.id}')">
                Edit
              </button>
              <button type="button" class="btn btn-whatsapp btn-sm" onclick="window.sendFarmerWhatsApp('${farmer.id}')">
                WhatsApp
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="window.confirmDeleteFarmer('${farmer.id}')">
                Delete
              </button>
            </div>
          `;
          container.appendChild(card);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // 1-Click Fast New Lifting Action from Farmer Master
  window.startLiftingForFarmer = async function (farmerId) {
    const farmer = await window.liftDeskDB.getFarmer(farmerId);
    if (!farmer) return;
    state.selectedFarmerForLifting = farmer;
    state.currentLiftingCages = [];
    navigateTo('viewLifting');
    // Set tab to "new"
    switchLiftingTab('new');
    updateLiftingFarmerUI();
    Native.showToast(`Farmer ${farmer.name} selected for lifting.`);
  };

  window.editFarmer = async function (farmerId) {
    const farmer = await window.liftDeskDB.getFarmer(farmerId);
    if (!farmer) return;
    document.getElementById('modalFarmerId').value = farmer.id;
    document.getElementById('modalFarmerName').value = farmer.name;
    document.getElementById('modalFarmerPhone').value = farmer.phone;
    document.getElementById('farmerModalTitle').textContent = `Edit Farmer (${farmer.id})`;
    openModal('modalFarmerRegister');
  };

  window.confirmDeleteFarmer = async function (farmerId) {
    try {
      const check = await window.liftDeskDB.canDeleteFarmer(farmerId);
      if (!check.canDelete) {
        showIntegrityAlert(check.reason);
        return;
      }

      if (confirm(`Are you sure you want to delete this farmer?`)) {
        await window.liftDeskDB.deleteFarmer(farmerId);
        Native.showToast('Farmer deleted.');
        loadFarmersList();
      }
    } catch (e) {
      showIntegrityAlert(e.message);
    }
  };

  window.sendFarmerWhatsApp = async function (farmerId) {
    const rep = await window.liftDeskDB.getFarmerReport(farmerId);
    const text = `*MPF LiftDesk - Farmer Statement*\n\n` +
      `Farmer: *${rep.farmer.name}*\n` +
      `Farmer ID: ${rep.farmer.id}\n` +
      `Total Liftings: ${rep.totalLiftings}\n` +
      `Total Cages: ${rep.totalCages}\n` +
      `Total Live Weight: ${formatKg(rep.totalWeight)} kg\n` +
      `Total Birds: ${rep.totalBirds}\n` +
      `Average Bird Weight: ${formatKg(rep.avgWeightPerBird)} kg\n\n` +
      `Thank you for partnering with MPF!`;
    Native.openWhatsApp(rep.farmer.phone, text);
  };

  window.viewFarmerReport = async function (farmerId) {
    try {
      const rep = await window.liftDeskDB.getFarmerReport(farmerId);
      document.getElementById('repFarmerName').textContent = rep.farmer.name;
      document.getElementById('repFarmerPhone').textContent = rep.farmer.phone;
      document.getElementById('repFarmerId').textContent = rep.farmer.id;
      document.getElementById('repTotalLiftings').textContent = rep.totalLiftings;
      document.getElementById('repTotalCages').textContent = rep.totalCages;
      document.getElementById('repTotalWeight').textContent = `${formatKg(rep.totalWeight)} kg`;
      document.getElementById('repTotalBirds').textContent = rep.totalBirds;

      const tbody = document.getElementById('repLiftingsTbody');
      tbody.innerHTML = '';

      if (rep.liftings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No liftings recorded yet.</td></tr>`;
      } else {
        rep.liftings.forEach(l => {
          const avg = l.totalBirds > 0 ? (l.totalWeight / l.totalBirds) : 0;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${l.id}</strong></td>
            <td>${l.liftingDate}</td>
            <td>${l.cages.map(c => c.cageNumber).join(', ')}</td>
            <td><strong>${formatKg(l.totalWeight)} kg</strong></td>
            <td>${l.totalBirds}</td>
            <td>${formatKg(avg)} kg</td>
          `;
          tbody.appendChild(tr);
        });
      }

      document.getElementById('btnFarmerReportWhatsApp').onclick = () => window.sendFarmerWhatsApp(farmerId);
      document.getElementById('btnPrintFarmerReport').onclick = () => Native.print();

      openModal('modalFarmerReport');
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  };

  async function saveFarmerFromModal() {
    const id = document.getElementById('modalFarmerId').value;
    const name = document.getElementById('modalFarmerName').value.trim();
    const phone = document.getElementById('modalFarmerPhone').value.trim();

    if (!name) {
      Native.showToast('Please enter the farmer full name.');
      return;
    }
    if (!phone) {
      Native.showToast('Please enter the phone number.');
      return;
    }

    try {
      if (id) {
        await window.liftDeskDB.updateFarmer(id, name, phone);
        Native.showToast('Farmer updated successfully.');
      } else {
        const farmer = await window.liftDeskDB.addFarmer(name, phone);
        Native.showToast(`Farmer ${farmer.name} registered with ID ${farmer.id}!`);
      }
      closeModal('modalFarmerRegister');
      loadFarmersList();
    } catch (err) {
      Native.showToast(err.message);
    }
  }

  // Farmer Selector Dialog (Search-first for high-volume)
  function openFarmerSelectorDialog() {
    const input = document.getElementById('inputModalFarmerSearch');
    input.value = '';
    searchModalFarmers('');
    openModal('modalFarmerSelector');
    setTimeout(() => input.focus(), 150);
  }

  async function searchModalFarmers(query) {
    const res = await window.liftDeskDB.searchFarmers(query, 1, 20);
    const list = document.getElementById('modalFarmerResultsList');
    list.innerHTML = '';

    if (res.items.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No matching farmers. Tap "+ Register New Farmer" below.</div>`;
    } else {
      res.items.forEach(farmer => {
        const div = document.createElement('div');
        div.style.padding = '10px 12px';
        div.style.borderBottom = '1px solid #E2E8F0';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.cursor = 'pointer';
        div.innerHTML = `
          <div>
            <div style="font-weight:700;color:#0F172A;">${escapeHtml(farmer.name)}</div>
            <div style="font-size:12px;color:#64748B;">ID: ${farmer.id} | Phone: ${escapeHtml(farmer.phone)}</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm">Select</button>
        `;
        div.onclick = () => {
          state.selectedFarmerForLifting = farmer;
          updateLiftingFarmerUI();
          closeModal('modalFarmerSelector');
          Native.showToast(`Selected farmer: ${farmer.name}`);
        };
        list.appendChild(div);
      });
    }
  }

  // --- 4. SALES MODULE CONTROLLER ---
  // Strictly NO Farm Rate or Profit!
  async function loadSalesView() {
    const dateInput = document.getElementById('inputSaleDate');
    if (!dateInput.value) {
      dateInput.value = getTodayString();
    }

    await populateSaleStoresDropdown();
    await populateSaleLiftingsDropdown();
    loadSalesInvoices();
  }

  async function populateSaleStoresDropdown() {
    const stores = await window.liftDeskDB.getAllStores();
    const select = document.getElementById('selectSaleStore');
    const prevVal = select.value;
    select.innerHTML = '<option value="">-- Select Store --</option>';
    stores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const isWk = s.isWangkhei || s.name.toLowerCase().includes('wangkhei');
      opt.textContent = isWk ? `🏪 ${s.name} (Singke Auto-Deduction)` : `${s.name} (${s.phone})`;
      select.appendChild(opt);
    });
    if (prevVal) select.value = prevVal;
  }

  async function populateSaleLiftingsDropdown() {
    const liftingsData = await window.liftDeskDB.getLiftings(1, 100);
    const select = document.getElementById('selectSaleLifting');
    select.innerHTML = '<option value="">-- Select Lifting / Farm Reference --</option>';

    for (const l of liftingsData.items) {
      const availableCages = await window.liftDeskDB.getAvailableCagesByLifting(l.id);
      if (availableCages.length > 0) {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = `${l.id} - ${l.farmerName} (${l.liftingDate}) [${availableCages.length} cages left]`;
        select.appendChild(opt);
      }
    }
  }

  // --- MULTI-CAGE BULK BILLING CONTROLLER ---

  function renderSaleAvailableCagesChips() {
    const container = document.getElementById('saleAvailableCagesChips');
    const badge = document.getElementById('saleAvailableCagesBadge');
    if (!container) return;

    const available = state.saleAvailableCages || [];
    if (badge) {
      badge.textContent = `${available.length} available`;
    }

    if (available.length === 0) {
      const liftingId = document.getElementById('selectSaleLifting').value;
      if (!liftingId) {
        container.innerHTML = '<div style="font-size:12px;color:#94A3B8;padding:4px 0;">-- Select a lifting reference above to view available cages --</div>';
      } else {
        container.innerHTML = '<div style="font-size:12px;color:var(--danger);padding:4px 0;font-weight:600;">No unsold cages left in this lifting reference.</div>';
      }
      return;
    }

    const selectedIds = new Set((state.saleSelectedCages || []).map(c => c.cageId));
    container.innerHTML = '';

    available.forEach(cage => {
      const isSelected = selectedIds.has(cage.id);
      const chip = document.createElement('div');
      chip.className = `sale-cage-chip ${isSelected ? 'selected' : ''}`;
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.title = isSelected ? 'Click to unselect this cage' : 'Click to select this cage for billing';
      chip.innerHTML = `
        <span class="chip-check">${isSelected ? '✓' : '+'}</span>
        <span><strong>Cage #${cage.cageNumber}</strong> (${formatKg(cage.weight)} kg &bull; ${cage.birdCount || 0} b)</span>
      `;
      chip.onclick = () => toggleSaleCageSelection(cage.id);
      container.appendChild(chip);
    });
  }

  function toggleSaleCageSelection(cageId) {
    const existingIdx = (state.saleSelectedCages || []).findIndex(c => c.cageId === cageId);
    if (existingIdx >= 0) {
      // Unselect
      state.saleSelectedCages.splice(existingIdx, 1);
    } else {
      // Select
      const cage = (state.saleAvailableCages || []).find(c => c.id === cageId);
      if (cage) {
        state.saleSelectedCages.push({
          cageId: cage.id,
          cageNumber: cage.cageNumber,
          birdCount: cage.birdCount || 0,
          originalWeight: cage.weight,
          weight: cage.weight
        });
        // Keep sorted by cage number
        state.saleSelectedCages.sort((a, b) => {
          const numA = parseInt(a.cageNumber, 10);
          const numB = parseInt(b.cageNumber, 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return String(a.cageNumber).localeCompare(String(b.cageNumber));
        });
      }
    }

    renderSaleAvailableCagesChips();
    renderSaleSelectedCagesTable();
    updateSaleCalculations();
  }

  function renderSaleSelectedCagesTable() {
    const tbody = document.getElementById('saleSelectedCagesTbody');
    const emptyMsg = document.getElementById('saleNoCagesSelectedMsg');
    const countHeader = document.getElementById('saleSelectedCountHeader');
    const sumCagesCount = document.getElementById('saleSumCagesCount');
    const sumBirdsCount = document.getElementById('saleSumBirdsCount');
    const sumLiftedWeight = document.getElementById('saleSumLiftedWeight');
    const sumBilledWeight = document.getElementById('saleSumBilledWeight');
    const sumWeightDiff = document.getElementById('saleSumWeightDiff');
    const btnResetAll = document.getElementById('btnResetAllBilledWeights');
    const btnSaveCount = document.getElementById('btnSaveSaleCagesCount');

    const selected = state.saleSelectedCages || [];
    const count = selected.length;

    if (countHeader) countHeader.textContent = count;
    if (sumCagesCount) sumCagesCount.textContent = count;
    if (btnSaveCount) btnSaveCount.textContent = count;

    if (!tbody) return;
    tbody.innerHTML = '';

    if (count === 0) {
      if (emptyMsg) emptyMsg.style.display = 'block';
      if (sumBirdsCount) sumBirdsCount.textContent = '0';
      if (sumLiftedWeight) sumLiftedWeight.textContent = '0.00';
      if (sumBilledWeight) sumBilledWeight.textContent = '0.00';
      if (sumWeightDiff) sumWeightDiff.textContent = '0.00 kg';
      const sumAdjustWrap = document.getElementById('saleSumAdjustWrap');
      if (sumAdjustWrap) sumAdjustWrap.style.display = 'none';
      if (btnResetAll) btnResetAll.style.display = 'none';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';

    let totalBirds = 0;
    let totalLifted = 0;
    let totalBilled = 0;
    let hasAnyVariance = false;

    selected.forEach(item => {
      const orig = parseFloat(item.originalWeight) || 0;
      const billed = parseFloat(item.weight) || 0;
      const diff = Math.round((billed - orig) * 100) / 100;
      const isModified = Math.abs(diff) >= 0.01;
      if (isModified) hasAnyVariance = true;

      totalBirds += (item.birdCount || 0);
      totalLifted += orig;
      totalBilled += billed;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${escapeHtml(item.cageNumber)}</strong></td>
        <td>${item.birdCount || 0}</td>
        <td style="color:#475569;font-weight:600;">${formatKg(orig)} kg</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <input type="number" step="0.01" min="0.01" class="cage-billed-wt-input ${isModified ? 'modified' : ''}" data-cage-id="${item.cageId}" value="${billed > 0 ? billed : ''}" placeholder="0.00">
            <span style="font-size:12px;font-weight:600;color:#64748B;">kg</span>
            ${isModified ? `
              <span style="font-size:11px;font-weight:700;color:var(--primary);">${diff > 0 ? '+' : ''}${diff.toFixed(2)} kg</span>
              <button type="button" class="btn-quick-reset" data-cage-id="${item.cageId}" title="Reset to default lifting weight (${formatKg(orig)} kg)">↺</button>
            ` : ''}
          </div>
        </td>
        <td style="text-align:center;">
          <button type="button" class="btn-remove-cage-row" data-cage-id="${item.cageId}" title="Remove cage from invoice">✕</button>
        </td>
      `;

      // Listen for weight input change
      const input = tr.querySelector('.cage-billed-wt-input');
      input.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        item.weight = !isNaN(val) ? val : 0;
        updateSelectedCagesSummariesOnly();
        updateSaleCalculations();
      });

      // Reset single cage button
      const resetBtn = tr.querySelector('.btn-quick-reset');
      if (resetBtn) {
        resetBtn.onclick = () => {
          item.weight = item.originalWeight;
          renderSaleSelectedCagesTable();
          updateSaleCalculations();
        };
      }

      // Remove row button
      const removeBtn = tr.querySelector('.btn-remove-cage-row');
      removeBtn.onclick = () => toggleSaleCageSelection(item.cageId);

      tbody.appendChild(tr);
    });

    totalLifted = Math.round(totalLifted * 100) / 100;
    totalBilled = Math.round(totalBilled * 100) / 100;
    const netDiff = Math.round((totalBilled - totalLifted) * 100) / 100;

    if (sumBirdsCount) sumBirdsCount.textContent = totalBirds;
    if (sumLiftedWeight) sumLiftedWeight.textContent = formatKg(totalLifted);
    if (sumBilledWeight) sumBilledWeight.textContent = formatKg(totalBilled);
    const sumAdjustWrap = document.getElementById('saleSumAdjustWrap');
    if (sumWeightDiff) {
      if (Math.abs(netDiff) >= 0.01) {
        const sign = netDiff > 0 ? '+' : '';
        sumWeightDiff.textContent = `${sign}${netDiff.toFixed(2)} kg`;
        if (sumAdjustWrap) sumAdjustWrap.style.display = 'inline-block';
      } else {
        sumWeightDiff.textContent = '0.00 kg';
        if (sumAdjustWrap) sumAdjustWrap.style.display = 'none';
      }
    }
    if (btnResetAll) {
      btnResetAll.style.display = hasAnyVariance ? 'inline-block' : 'none';
    }
  }

  function updateSelectedCagesSummariesOnly() {
    const selected = state.saleSelectedCages || [];
    let totalLifted = 0;
    let totalBilled = 0;
    let hasAnyVariance = false;

    selected.forEach(item => {
      const orig = parseFloat(item.originalWeight) || 0;
      const billed = parseFloat(item.weight) || 0;
      const diff = Math.round((billed - orig) * 100) / 100;
      if (Math.abs(diff) >= 0.01) hasAnyVariance = true;
      totalLifted += orig;
      totalBilled += billed;
    });

    totalLifted = Math.round(totalLifted * 100) / 100;
    totalBilled = Math.round(totalBilled * 100) / 100;
    const netDiff = Math.round((totalBilled - totalLifted) * 100) / 100;

    const sumLiftedWeight = document.getElementById('saleSumLiftedWeight');
    const sumBilledWeight = document.getElementById('saleSumBilledWeight');
    const sumWeightDiff = document.getElementById('saleSumWeightDiff');
    const sumAdjustWrap = document.getElementById('saleSumAdjustWrap');
    const btnResetAll = document.getElementById('btnResetAllBilledWeights');

    if (sumLiftedWeight) sumLiftedWeight.textContent = formatKg(totalLifted);
    if (sumBilledWeight) sumBilledWeight.textContent = formatKg(totalBilled);
    if (sumWeightDiff) {
      if (Math.abs(netDiff) >= 0.01) {
        const sign = netDiff > 0 ? '+' : '';
        sumWeightDiff.textContent = `${sign}${netDiff.toFixed(2)} kg`;
        if (sumAdjustWrap) sumAdjustWrap.style.display = 'inline-block';
      } else {
        sumWeightDiff.textContent = '0.00 kg';
        if (sumAdjustWrap) sumAdjustWrap.style.display = 'none';
      }
    }
    if (btnResetAll) {
      btnResetAll.style.display = hasAnyVariance ? 'inline-block' : 'none';
    }
  }

  async function onSaleLiftingSelected(liftingId) {
    state.saleAvailableCages = [];
    state.saleSelectedCages = [];

    if (!liftingId) {
      renderSaleAvailableCagesChips();
      renderSaleSelectedCagesTable();
      updateSaleCalculations();
      return;
    }

    try {
      const availableCages = await window.liftDeskDB.getAvailableCagesByLifting(liftingId);
      availableCages.sort((a, b) => {
        const numA = parseInt(a.cageNumber, 10);
        const numB = parseInt(b.cageNumber, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.cageNumber).localeCompare(String(b.cageNumber));
      });
      state.saleAvailableCages = availableCages;
    } catch (err) {
      console.error(err);
      state.saleAvailableCages = [];
    }

    renderSaleAvailableCagesChips();
    renderSaleSelectedCagesTable();
    updateSaleCalculations();
  }

  async function onSaleStoreSelected(storeId) {
    const notice = document.getElementById('saleStoreDueNotice');
    if (!storeId) {
      notice.textContent = '';
      updateSaleCalculations();
      return;
    }

    try {
      const store = await window.liftDeskDB.getStore(storeId);
      const fin = await window.liftDeskDB.getStoreFinancialSummary(storeId);
      const isWk = store && (store.isWangkhei || store.name.toLowerCase().includes('wangkhei'));
      if (isWk) {
        notice.innerHTML = `<span style="color:#047857;font-weight:700;">🏪 Wangkhei Store (Singke Account):</span> Outstanding ₹${formatCurrency(fin.currentOutstanding)}. <span style="color:#10B981;font-weight:600;">(Auto-deducted from remaining due to Singke)</span>`;
      } else {
        notice.textContent = `Current Outstanding Balance: ₹${formatCurrency(fin.currentOutstanding)}`;
      }
      updateSaleCalculations();
    } catch (e) {
      notice.textContent = '';
    }
  }

  async function updateSaleCalculations() {
    const storeId = document.getElementById('selectSaleStore').value;
    const selectedCages = state.saleSelectedCages || [];
    const totalWeight = selectedCages.reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0);
    const totalBirds = selectedCages.reduce((sum, c) => sum + (c.birdCount || 0), 0);
    const rate = parseFloat(document.getElementById('inputSaleRate').value) || 0;
    const paid = parseFloat(document.getElementById('inputSalePaidAmount').value) || 0;

    let previousDue = 0;
    if (storeId) {
      try {
        const fin = await window.liftDeskDB.getStoreFinancialSummary(storeId);
        previousDue = fin.currentOutstanding;
      } catch (e) { }
    }

    const billedWeight = Math.round(totalWeight * 100) / 100;
    const saleAmount = Math.round(billedWeight * rate * 100) / 100;
    const outstanding = Math.round((previousDue + saleAmount - paid) * 100) / 100;

    const previewWeight = document.getElementById('previewSaleWeight');
    const previewRate = document.getElementById('previewSaleRate');
    const previewCagesCount = document.getElementById('previewSaleCagesCount');
    const previewBirdsCount = document.getElementById('previewSaleBirdsCount');
    const previewAmount = document.getElementById('previewSaleAmount');
    const previewPrevDue = document.getElementById('previewPreviousDue');
    const previewPaid = document.getElementById('previewPaidAmount');
    const previewOut = document.getElementById('previewOutstanding');

    if (previewWeight) previewWeight.textContent = formatKg(billedWeight);
    if (previewRate) previewRate.textContent = formatCurrency(rate);
    if (previewCagesCount) previewCagesCount.textContent = selectedCages.length;
    if (previewBirdsCount) previewBirdsCount.textContent = totalBirds;
    if (previewAmount) previewAmount.textContent = formatCurrency(saleAmount);
    if (previewPrevDue) previewPrevDue.textContent = formatCurrency(previousDue);
    if (previewPaid) previewPaid.textContent = formatCurrency(paid);
    if (previewOut) previewOut.textContent = formatCurrency(outstanding);
  }

  async function saveSaleForm() {
    const storeId = document.getElementById('selectSaleStore').value;
    const saleDate = document.getElementById('inputSaleDate').value;
    const liftingId = document.getElementById('selectSaleLifting').value;
    const salesRate = document.getElementById('inputSaleRate').value;
    const paidAmount = document.getElementById('inputSalePaidAmount').value;
    const paymentMethod = document.getElementById('selectSalePaymentType').value;
    const selectedCages = state.saleSelectedCages || [];

    if (!storeId) {
      Native.showToast('Please select a store.');
      return;
    }
    if (!saleDate) {
      Native.showToast('Please specify the sale date.');
      return;
    }
    if (!liftingId) {
      Native.showToast('Please select a lifting reference.');
      return;
    }
    if (selectedCages.length === 0) {
      Native.showToast('Please select at least one cage to bill.');
      return;
    }

    // Validate that every cage has a valid positive weight
    const invalidCage = selectedCages.find(c => !c.weight || parseFloat(c.weight) <= 0);
    if (invalidCage) {
      Native.showToast(`Please enter a valid weight for Cage #${invalidCage.cageNumber}.`);
      return;
    }

    if (!salesRate || parseFloat(salesRate) <= 0) {
      Native.showToast('Please enter a valid sales rate (₹/kg).');
      return;
    }

    try {
      const sale = await window.liftDeskDB.saveSale({
        storeId,
        saleDate,
        liftingId,
        cages: selectedCages.map(c => ({
          cageId: c.cageId,
          cageNumber: c.cageNumber,
          birdCount: c.birdCount || 0,
          originalWeight: c.originalWeight,
          weight: Math.round(parseFloat(c.weight) * 100) / 100
        })),
        salesRate,
        paidAmount,
        paymentMethod
      });

      Native.showToast(`Invoice ${sale.invoiceNumber} generated for ${sale.totalCages || selectedCages.length} cages!`);
      resetSaleForm();
      loadSalesInvoices();
      loadDashboard();
      // Show Invoice
      window.viewInvoice(sale.id);
    } catch (err) {
      console.error(err);
      Native.showToast(err.message);
    }
  }

  function resetSaleForm() {
    document.getElementById('selectSaleStore').value = '';
    document.getElementById('inputSaleDate').value = getTodayString();
    document.getElementById('selectSaleLifting').value = '';
    state.saleAvailableCages = [];
    state.saleSelectedCages = [];
    renderSaleAvailableCagesChips();
    renderSaleSelectedCagesTable();
    document.getElementById('inputSaleRate').value = '';
    document.getElementById('inputSalePaidAmount').value = '';
    document.getElementById('saleStoreDueNotice').textContent = '';
    updateSaleCalculations();
  }

  async function loadSalesInvoices() {
    try {
      const res = await window.liftDeskDB.getSales(1, 30);
      const tbody = document.getElementById('salesHistoryTbody');
      const empty = document.getElementById('salesHistoryEmpty');
      const countEl = document.getElementById('salesHistoryCount');

      countEl.textContent = `${res.total} Invoices`;
      tbody.innerHTML = '';

      if (res.items.length === 0) {
        empty.style.display = 'block';
      } else {
        empty.style.display = 'none';
        res.items.forEach(s => {
          const tr = document.createElement('tr');
          const isMultiCage = s.cages && Array.isArray(s.cages) && s.cages.length > 1;
          const cageCellContent = isMultiCage
            ? `<span class="badge" style="background:#EFF6FF;color:#1D4ED8;font-weight:700;margin-bottom:2px;display:inline-block;">${s.cages.length} Cages</span> <div style="font-size:11px;color:#64748B;">${escapeHtml(s.cageNumber)}</div>`
            : `Cage ${escapeHtml(s.cageNumber)}`;

          const weightCellContent = `${formatKg(s.weight)} kg`;

          tr.innerHTML = `
            <td><strong>${s.invoiceNumber}</strong></td>
            <td>${s.saleDate}</td>
            <td><strong>${escapeHtml(s.storeName)}</strong></td>
            <td>${cageCellContent}</td>
            <td>${weightCellContent}</td>
            <td>₹${formatCurrency(s.salesRate)}</td>
            <td><strong>₹${formatCurrency(s.saleAmount)}</strong></td>
            <td>₹${formatCurrency(s.paidAmount)}</td>
            <td style="color:var(--danger);font-weight:700;">₹${formatCurrency(s.outstanding)}</td>
            <td>
              <div style="display:flex;gap:4px;">
                <button class="btn btn-outline btn-sm" onclick="window.viewInvoice('${s.id}')">View</button>
                <button class="btn btn-whatsapp btn-sm" onclick="window.sendInvoiceWhatsApp('${s.id}')">WhatsApp</button>
                <button class="btn btn-danger btn-sm" onclick="window.confirmDeleteSale('${s.id}')">✕</button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  window.viewInvoice = async function (saleId) {
    try {
      const sale = await window.liftDeskDB.getSale(saleId);
      if (!sale) return;
      const store = await window.liftDeskDB.getStore(sale.storeId);

      document.getElementById('invNumber').textContent = sale.invoiceNumber;
      document.getElementById('invStoreName').textContent = store ? store.name : 'Unknown Store';
      document.getElementById('invStorePhone').textContent = store ? store.phone : '--';
      document.getElementById('invDate').textContent = sale.saleDate;
      document.getElementById('invLiftingRef').textContent = sale.liftingId;

      const tbody = document.getElementById('invCagesTbody');
      const tfoot = document.getElementById('invCagesTfoot');

      if (tbody) tbody.innerHTML = '';
      if (tfoot) tfoot.innerHTML = '';

      if (sale.cages && Array.isArray(sale.cages) && sale.cages.length > 0) {
        sale.cages.forEach((c, idx) => {
          const rowAmount = Math.round(c.weight * sale.salesRate * 100) / 100;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>Cage #${escapeHtml(c.cageNumber)}</strong></td>
            <td>${c.birdCount || 0}</td>
            <td>${formatKg(c.weight)} kg</td>
            <td>₹${formatCurrency(sale.salesRate)}</td>
            <td style="text-align:right;font-weight:600;">₹${formatCurrency(rowAmount)}</td>
          `;
          if (tbody) tbody.appendChild(tr);
        });

        if (tfoot) {
          const totalBirds = sale.totalBirds || sale.cages.reduce((sum, c) => sum + (c.birdCount || 0), 0);
          tfoot.innerHTML = `
            <tr>
              <td colspan="2">Total (${sale.cages.length} Cages)</td>
              <td>${totalBirds} birds</td>
              <td><strong style="color:var(--primary);">${formatKg(sale.weight)} kg</strong></td>
              <td>@ ₹${formatCurrency(sale.salesRate)}</td>
              <td style="text-align:right;font-size:15px;color:var(--primary);">₹${formatCurrency(sale.saleAmount)}</td>
            </tr>
          `;
        }
      } else {
        // Fallback for single-cage legacy invoices
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td>1</td>
              <td><strong>Cage ${escapeHtml(sale.cageNumber)}</strong></td>
              <td>--</td>
              <td>${formatKg(sale.weight)} kg</td>
              <td>₹${formatCurrency(sale.salesRate)}</td>
              <td style="text-align:right;font-weight:700;">₹${formatCurrency(sale.saleAmount)}</td>
            </tr>
          `;
        }
        if (tfoot) {
          tfoot.innerHTML = `
            <tr>
              <td colspan="3">Total</td>
              <td><strong>${formatKg(sale.weight)} kg</strong></td>
              <td></td>
              <td style="text-align:right;"><strong>₹${formatCurrency(sale.saleAmount)}</strong></td>
            </tr>
          `;
        }
      }

      document.getElementById('invSubtotal').textContent = `₹${formatCurrency(sale.saleAmount)}`;
      document.getElementById('invPrevDue').textContent = `₹${formatCurrency(sale.previousDue)}`;
      document.getElementById('invPayMethod').textContent = sale.paymentMethod || 'Cash';
      document.getElementById('invPaid').textContent = `₹${formatCurrency(sale.paidAmount)}`;
      document.getElementById('invOutstanding').textContent = `₹${formatCurrency(sale.outstanding)}`;

      document.getElementById('btnInvoiceWhatsApp').onclick = () => window.sendInvoiceWhatsApp(sale.id);
      document.getElementById('btnPrintInvoice').onclick = () => Native.print();

      openModal('modalInvoice');
    } catch (e) {
      console.error(e);
    }
  };

  window.sendInvoiceWhatsApp = async function (saleId) {
    const sale = await window.liftDeskDB.getSale(saleId);
    if (!sale) return;
    const store = await window.liftDeskDB.getStore(sale.storeId);
    if (!store) return;

    let itemsBreakdown = '';
    if (sale.cages && Array.isArray(sale.cages) && sale.cages.length > 0) {
      itemsBreakdown = `*Billed Cages (${sale.cages.length} cages, ${sale.totalBirds || 0} birds):*\n` +
        sale.cages.map((c, i) => {
          const lineAmt = Math.round(c.weight * sale.salesRate * 100) / 100;
          return `${i + 1}. Cage #${c.cageNumber} (${c.birdCount || 0} b): ${formatKg(c.weight)} kg = ₹${formatCurrency(lineAmt)}`;
        }).join('\n') + '\n\n';
    } else {
      itemsBreakdown = `Cage: ${sale.cageNumber}\nWeight: ${formatKg(sale.weight)} kg\n\n`;
    }

    const text = `*MPF LiftDesk - Sales Invoice*\n\n` +
      `Invoice #: *${sale.invoiceNumber}*\n` +
      `Date: ${sale.saleDate}\n` +
      `Store: *${store.name}*\n` +
      `Lifting Ref: ${sale.liftingId}\n\n` +
      itemsBreakdown +
      `*Total Billed Weight: ${formatKg(sale.weight)} kg*\n` +
      `Sales Rate: ₹${formatCurrency(sale.salesRate)} /kg\n` +
      `*Sale Amount: ₹${formatCurrency(sale.saleAmount)}*\n\n` +
      `Previous Due: ₹${formatCurrency(sale.previousDue)}\n` +
      `Paid Amount: ₹${formatCurrency(sale.paidAmount)} (${sale.paymentMethod || 'Cash'})\n` +
      `*Net Outstanding Due: ₹${formatCurrency(sale.outstanding)}*\n\n` +
      `Thank you for your business!`;

    Native.openWhatsApp(store.phone, text);
  };

  window.confirmDeleteSale = async function (saleId) {
    if (confirm('Delete this sales invoice? All cages in this invoice will be restored and made available for sale again.')) {
      try {
        await window.liftDeskDB.deleteSale(saleId);
        Native.showToast('Sale deleted and cages restored to available stock.');
        loadSalesInvoices();
        loadDashboard();
      } catch (err) {
        showIntegrityAlert(err.message);
      }
    }
  };

  // --- 5. STORE MASTER CONTROLLER ---
  async function loadStoresList() {
    try {
      const stores = await window.liftDeskDB.getAllStores();
      const container = document.getElementById('storesListContainer');
      const empty = document.getElementById('storesEmptyState');
      const searchVal = (document.getElementById('inputStoreSearch').value || '').trim().toLowerCase();

      container.innerHTML = '';

      const filtered = stores.filter(s => {
        if (!searchVal) return true;
        return s.name.toLowerCase().includes(searchVal) || s.phone.includes(searchVal);
      });

      if (filtered.length === 0) {
        empty.style.display = 'block';
      } else {
        empty.style.display = 'none';
        for (const store of filtered) {
          const fin = await window.liftDeskDB.getStoreFinancialSummary(store.id);

          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div>
                <div style="font-size:16px;font-weight:800;color:var(--text-main);">${escapeHtml(store.name)}</div>
                <div style="font-size:13px;color:var(--text-muted);">📞 ${escapeHtml(store.phone)}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:11px;color:var(--text-muted);font-weight:600;">NET OUTSTANDING</div>
                <div style="font-size:18px;font-weight:800;color:var(--danger);">₹${formatCurrency(fin.currentOutstanding)}</div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);background:#F8FAFC;padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:12px;">
              <div>
                <span style="color:var(--text-muted);display:block;">Opening Due</span>
                <strong>₹${formatCurrency(fin.openingDue)}</strong>
              </div>
              <div>
                <span style="color:var(--text-muted);display:block;">Total Purchases</span>
                <strong>₹${formatCurrency(fin.totalSales)}</strong>
              </div>
              <div>
                <span style="color:var(--text-muted);display:block;">Total Paid</span>
                <strong style="color:var(--success);">₹${formatCurrency(fin.totalPaid)}</strong>
              </div>
            </div>

            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-outline btn-sm" onclick="window.viewStoreStatement('${store.id}')">Statement</button>
              <button class="btn btn-whatsapp btn-sm" onclick="window.sendStoreDueReminderWhatsApp('${store.id}')">WhatsApp Reminder</button>
              <button class="btn btn-outline btn-sm" onclick="window.editStore('${store.id}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="window.confirmDeleteStore('${store.id}')">Delete</button>
            </div>
          `;
          container.appendChild(card);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  window.editStore = async function (storeId) {
    const s = await window.liftDeskDB.getStore(storeId);
    if (!s) return;
    document.getElementById('modalStoreId').value = s.id;
    document.getElementById('modalStoreName').value = s.name;
    document.getElementById('modalStorePhone').value = s.phone;
    document.getElementById('modalStoreOpeningDue').value = s.openingDue || 0;
    document.getElementById('storeModalTitle').textContent = `Edit Store (${s.id})`;
    openModal('modalStore');
  };

  window.confirmDeleteStore = async function (storeId) {
    try {
      const check = await window.liftDeskDB.canDeleteStore(storeId);
      if (!check.canDelete) {
        showIntegrityAlert(check.reason);
        return;
      }
      if (confirm('Are you sure you want to delete this store?')) {
        await window.liftDeskDB.deleteStore(storeId);
        Native.showToast('Store deleted.');
        loadStoresList();
      }
    } catch (err) {
      showIntegrityAlert(err.message);
    }
  };

  window.sendStoreDueReminderWhatsApp = async function (storeId) {
    const fin = await window.liftDeskDB.getStoreFinancialSummary(storeId);
    const text = `*MPF LiftDesk - Payment Reminder*\n\n` +
      `Dear *${fin.store.name}*,\n` +
      `Your current outstanding balance is *₹${formatCurrency(fin.currentOutstanding)}*.\n\n` +
      `Total purchases billed: ₹${formatCurrency(fin.totalSales)}\n` +
      `Total payments received: ₹${formatCurrency(fin.totalPaid)}\n\n` +
      `Please clear the due balance at your earliest convenience. Thank you!`;
    Native.openWhatsApp(fin.store.phone, text);
  };

  window.viewStoreStatement = async function (storeId) {
    try {
      const stmt = await window.liftDeskDB.getStoreStatement(storeId);
      document.getElementById('statementStoreInfo').textContent = `${stmt.store.name} | Phone: ${stmt.store.phone}`;
      document.getElementById('statementNetDue').textContent = formatCurrency(stmt.finalBalance);

      const tbody = document.getElementById('statementTbody');
      tbody.innerHTML = '';

      if (stmt.entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No transaction history yet.</td></tr>`;
      } else {
        stmt.entries.forEach(e => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${e.date}</td>
            <td><span class="badge" style="background:#F1F5F9;font-size:11px;padding:2px 6px;border-radius:4px;">${e.type}</span></td>
            <td>${escapeHtml(e.ref)}</td>
            <td>${escapeHtml(e.details)}</td>
            <td>${e.debit > 0 ? '₹' + formatCurrency(e.debit) : '-'}</td>
            <td style="color:var(--success);">${e.credit > 0 ? '₹' + formatCurrency(e.credit) : '-'}</td>
            <td><strong>₹${formatCurrency(e.balance)}</strong></td>
          `;
          tbody.appendChild(tr);
        });
      }

      document.getElementById('btnStoreStatementWhatsApp').onclick = () => window.sendStoreDueReminderWhatsApp(storeId);
      document.getElementById('btnPrintStoreStatement').onclick = () => Native.print();

      openModal('modalStoreStatement');
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  };

  async function saveStoreFromModal() {
    const id = document.getElementById('modalStoreId').value;
    const name = document.getElementById('modalStoreName').value.trim();
    const phone = document.getElementById('modalStorePhone').value.trim();
    const openingDue = parseFloat(document.getElementById('modalStoreOpeningDue').value) || 0;

    if (!name) {
      Native.showToast('Please enter store name.');
      return;
    }
    if (!phone) {
      Native.showToast('Please enter store WhatsApp number.');
      return;
    }

    try {
      if (id) {
        await window.liftDeskDB.updateStore(id, name, phone, openingDue);
        Native.showToast('Store updated successfully.');
      } else {
        const store = await window.liftDeskDB.addStore(name, phone, openingDue);
        Native.showToast(`Store "${store.name}" added successfully.`);
      }
      closeModal('modalStore');
      loadStoresList();
      populateSaleStoresDropdown();
      populatePaymentStoresDropdown();
    } catch (err) {
      Native.showToast(err.message);
    }
  }

  // --- 6. LEDGER (STORE DIRECT PAYMENTS) CONTROLLER ---
  async function loadLedgerView() {
    const dateInput = document.getElementById('inputPaymentDate');
    if (!dateInput.value) {
      dateInput.value = getTodayString();
    }
    await populatePaymentStoresDropdown();
    loadPaymentsHistory();
  }

  async function populatePaymentStoresDropdown() {
    const stores = await window.liftDeskDB.getAllStores();
    const select = document.getElementById('selectPaymentStore');
    select.innerHTML = '<option value="">-- Select Store --</option>';
    stores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.phone})`;
      select.appendChild(opt);
    });
  }

  async function saveDirectPayment() {
    const storeId = document.getElementById('selectPaymentStore').value;
    const paymentDate = document.getElementById('inputPaymentDate').value;
    const amount = document.getElementById('inputPaymentAmount').value;
    const paymentMethod = document.getElementById('selectPaymentMethod').value;
    const notes = document.getElementById('inputPaymentNotes').value;

    if (!storeId) {
      Native.showToast('Please select a store.');
      return;
    }
    if (!paymentDate) {
      Native.showToast('Please select payment date.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      Native.showToast('Please enter a valid payment amount.');
      return;
    }

    try {
      await window.liftDeskDB.addPayment({
        storeId,
        paymentDate,
        amount,
        paymentMethod,
        notes
      });

      Native.showToast('Payment recorded successfully.');
      document.getElementById('inputPaymentAmount').value = '';
      document.getElementById('inputPaymentNotes').value = '';
      loadPaymentsHistory();
      loadDashboard();
    } catch (err) {
      Native.showToast(err.message);
    }
  }

  async function loadPaymentsHistory() {
    try {
      const res = await window.liftDeskDB.getPayments(1, 30);
      const tbody = document.getElementById('paymentsHistoryTbody');
      const empty = document.getElementById('paymentsHistoryEmpty');
      const badge = document.getElementById('paymentsCountBadge');

      badge.textContent = `${res.total} Payments`;
      tbody.innerHTML = '';

      if (res.items.length === 0) {
        empty.style.display = 'block';
      } else {
        empty.style.display = 'none';
        res.items.forEach(p => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${p.paymentDate}</td>
            <td><strong>${escapeHtml(p.storeName)}</strong></td>
            <td style="color:var(--success);font-weight:700;">₹${formatCurrency(p.amount)}</td>
            <td>${p.paymentMethod}</td>
            <td>${escapeHtml(p.notes || '-')}</td>
            <td>
              <button class="btn btn-danger btn-sm" onclick="window.confirmDeletePayment('${p.id}')">✕</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  window.confirmDeletePayment = async function (paymentId) {
    if (confirm('Are you sure you want to delete this payment record?')) {
      await window.liftDeskDB.deletePayment(paymentId);
      Native.showToast('Payment deleted.');
      loadPaymentsHistory();
      loadDashboard();
    }
  };

  // --- 7. ACCOUNTING & REPORTS CONTROLLER ---
  async function loadAccountingView() {
    const period = document.getElementById('selectAccountingPeriod').value;
    let startDate = null;
    let endDate = null;
    const now = new Date();

    if (period === 'this_month') {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      startDate = `${y}-${m}-01`;
      endDate = getTodayString();
      document.getElementById('accPeriodLabel').textContent = `${now.toLocaleString('default', { month: 'long' })} ${y}`;
    } else if (period === 'last_month') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const y = prev.getFullYear();
      const m = String(prev.getMonth() + 1).padStart(2, '0');
      startDate = `${y}-${m}-01`;
      const lastDay = new Date(y, prev.getMonth() + 1, 0).getDate();
      endDate = `${y}-${m}-${lastDay}`;
      document.getElementById('accPeriodLabel').textContent = `${prev.toLocaleString('default', { month: 'long' })} ${y}`;
    } else if (period === 'this_year') {
      const y = now.getFullYear();
      startDate = `${y}-01-01`;
      endDate = getTodayString();
      document.getElementById('accPeriodLabel').textContent = `Year ${y}`;
    } else {
      document.getElementById('accPeriodLabel').textContent = 'All Time';
    }

    const summary = await window.liftDeskDB.getAccountingSummary(startDate, endDate);

    document.getElementById('accTotalSales').textContent = formatCurrency(summary.totalSalesIncome);
    document.getElementById('accTotalPayments').textContent = formatCurrency(summary.totalPaymentsReceived);
    document.getElementById('accTotalOutstanding').textContent = formatCurrency(summary.totalOutstanding);
    document.getElementById('accTotalWeight').textContent = formatKg(summary.totalLiftingWeight);
    document.getElementById('accTotalBirds').textContent = summary.totalLiftingBirds;
    document.getElementById('accTotalCages').textContent = summary.totalCagesLifted;

    document.getElementById('accCountLiftings').textContent = summary.liftingsCount;
    document.getElementById('accCountCages').textContent = summary.totalCagesLifted;
    document.getElementById('accCountBirds').textContent = summary.totalLiftingBirds;
    document.getElementById('accWeightDetailed').textContent = `${formatKg(summary.totalLiftingWeight)} kg`;

    document.getElementById('accCountSales').textContent = summary.salesCount;
    document.getElementById('accSalesDetailed').textContent = `₹${formatCurrency(summary.totalSalesIncome)}`;
    document.getElementById('accCountPayments').textContent = summary.paymentsCount;
    document.getElementById('accDirectPaymentsDetailed').textContent = `₹${formatCurrency(summary.directPaymentsReceived)}`;
    document.getElementById('accDueDetailed').textContent = `₹${formatCurrency(summary.totalOutstanding)}`;
  }

  // --- 7B. SINGKE & WANGKHEI ACCOUNTING CONTROLLER ---
  async function loadSingkeAccountView() {
    // Populate farmer dropdowns for settlement forms
    await populateSingkeFarmersDropdowns();

    // Set initial date filter values if empty
    const dateStartEl = document.getElementById('singkeDateStart');
    const dateEndEl = document.getElementById('singkeDateEnd');
    if (dateStartEl && dateEndEl) {
      dateStartEl.value = state.singkeFilter.startDate || '';
      dateEndEl.value = state.singkeFilter.endDate || '';
    }

    // Default today's date for quick settlement input
    const quickDate = document.getElementById('inputQuickSettleDate');
    if (quickDate && !quickDate.value) quickDate.value = getTodayString();

    const modalDate = document.getElementById('modalSettleDate');
    if (modalDate && !modalDate.value) modalDate.value = getTodayString();

    // Switch to currently active tab
    switchSingkeTab(state.singkeFilter.activeTab || 'summary');
  }

  function switchSingkeTab(tabName) {
    state.singkeFilter.activeTab = tabName;

    const tabs = ['summary', 'ledger', 'wangkhei', 'farmers', 'reports'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tabSingke${capitalize(t)}`);
      const pane = document.getElementById(`panelSingke${capitalize(t)}`);
      if (btn) {
        if (t === tabName) btn.classList.add('active');
        else btn.classList.remove('active');
      }
      if (pane) {
        pane.style.display = (t === tabName) ? 'block' : 'none';
      }
    });

    if (tabName === 'summary') renderSingkeSummary();
    if (tabName === 'ledger') renderSingkeLedger();
    if (tabName === 'wangkhei') renderSingkeWangkhei();
    if (tabName === 'farmers') renderSingkeFarmers();
    if (tabName === 'reports') renderSingkeReportsPreview();
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  async function populateSingkeFarmersDropdowns() {
    try {
      const farmers = await window.liftDeskDB.getAllFarmers();
      const selectQuick = document.getElementById('selectQuickSettleFarmer');
      const selectModal = document.getElementById('modalSettleFarmer');

      const buildOptions = (currentVal) => {
        let html = '<option value="">-- Optional Farmer Link --</option>';
        farmers.forEach(f => {
          html += `<option value="${f.id}" ${f.id === currentVal ? 'selected' : ''}>${escapeHtml(f.name)} (${f.id})</option>`;
        });
        return html;
      };

      if (selectQuick) {
        const val = selectQuick.value;
        selectQuick.innerHTML = buildOptions(val);
      }
      if (selectModal) {
        const val = selectModal.value;
        selectModal.innerHTML = buildOptions(val);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // --- RENDER SINGKE SUMMARY TAB ---
  async function renderSingkeSummary() {
    try {
      const startDate = state.singkeFilter.startDate || null;
      const endDate = state.singkeFilter.endDate || null;

      const summary = await window.liftDeskDB.getSingkeAccountSummary(startDate, endDate);

      // Hero Card
      const heroDue = document.getElementById('singkeHeroRemainingDue');
      if (heroDue) heroDue.textContent = formatCurrency(summary.remainingDueToSingke);

      // Stat Cards
      const statLiftVal = document.getElementById('singkeStatTotalLiftingAmount');
      const statLiftCount = document.getElementById('singkeStatLiftingCount');
      const statLiftWeight = document.getElementById('singkeStatTotalLiftingWeight');
      if (statLiftVal) statLiftVal.textContent = `₹${formatCurrency(summary.totalPayableToSingke)}`;
      if (statLiftCount) statLiftCount.textContent = `${summary.liftingsCount} liftings`;
      if (statLiftWeight) statLiftWeight.textContent = `${formatKg(summary.totalWeightLifted)} kg`;

      const statWkDed = document.getElementById('singkeStatWangkheiDeductions');
      const statWkCount = document.getElementById('singkeStatWangkheiCount');
      const statWkWeight = document.getElementById('singkeStatWangkheiWeight');
      if (statWkDed) statWkDed.textContent = `₹${formatCurrency(summary.totalWangkheiDeductions)}`;
      if (statWkCount) statWkCount.textContent = `${summary.wangkheiSalesCount} sales`;
      if (statWkWeight) statWkWeight.textContent = `${formatKg(summary.wangkheiWeightSold)} kg`;

      const statDirectSet = document.getElementById('singkeStatDirectSettlements');
      const statSetCount = document.getElementById('singkeStatSettlementCount');
      if (statDirectSet) statDirectSet.textContent = `₹${formatCurrency(summary.totalOtherSettlements)}`;
      if (statSetCount) statSetCount.textContent = `${summary.settlementsCount} records`;

      const statRemDue = document.getElementById('singkeStatRemainingDue');
      if (statRemDue) statRemDue.textContent = `₹${formatCurrency(summary.remainingDueToSingke)}`;

      // Render Recent Direct Settlements Table
      const tbody = document.getElementById('singkeRecentSettlementsTbody');
      const empty = document.getElementById('singkeRecentSettlementsEmpty');
      if (tbody) {
        tbody.innerHTML = '';
        const settlements = await window.liftDeskDB.getSingkeSettlements(startDate, endDate);
        settlements.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        if (settlements.length === 0) {
          if (empty) empty.style.display = 'block';
        } else {
          if (empty) empty.style.display = 'none';
          settlements.slice(0, 15).forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${s.date}</td>
              <td><strong>${s.refNumber || s.id}</strong></td>
              <td>${s.farmerName ? escapeHtml(s.farmerName) : '<span style="color:var(--text-muted);">General / Singke</span>'}</td>
              <td>${escapeHtml(s.paymentMethod || 'Cash')}</td>
              <td style="font-weight:700;color:#047857;">₹${formatCurrency(s.amount)}</td>
              <td>
                <span class="remarks-display" onclick="window.openEditRemarksModal('settlement', '${s.id}', '${escapeHtml(s.remarks || '')}', '${s.refNumber || s.id}', 'Settlement Payout')" title="Click to edit remarks">
                  ${s.remarks ? escapeHtml(s.remarks) : '<span style="color:var(--text-muted);font-style:italic;">+ Add note</span>'} ✏️
                </span>
              </td>
              <td>
                <div style="display:flex;gap:4px;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="window.openEditSettlementModal('${s.id}')">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" onclick="window.confirmDeleteSettlement('${s.id}')">✕</button>
                </div>
              </td>
            `;
            tbody.appendChild(tr);
          });
        }
      }
    } catch (err) {
      console.error('Error rendering Singke summary:', err);
    }
  }

  // --- SAVE QUICK SETTLEMENT (Direct Form) ---
  async function saveQuickSettlement() {
    const dateInput = document.getElementById('inputQuickSettleDate');
    const amountInput = document.getElementById('inputQuickSettleAmount');
    const methodInput = document.getElementById('inputQuickSettleMethod');
    const refInput = document.getElementById('inputQuickSettleRef');
    const farmerInput = document.getElementById('selectQuickSettleFarmer');
    const remarksInput = document.getElementById('inputQuickSettleRemarks');

    const amount = parseFloat(amountInput.value);
    if (isNaN(amount) || amount <= 0) {
      Native.showToast('Please enter a valid settlement amount greater than 0.');
      amountInput.focus();
      return;
    }

    const date = dateInput.value || getTodayString();
    const paymentMethod = methodInput.value || 'Cash';
    const refNumber = refInput.value.trim();
    const farmerId = farmerInput.value || null;
    const remarks = remarksInput.value.trim();

    try {
      const record = await window.liftDeskDB.addSingkeSettlement({
        date,
        amount,
        paymentMethod,
        refNumber,
        farmerId,
        remarks
      });

      Native.showToast(`Settlement of ₹${formatCurrency(amount)} to Singke recorded!`);

      // Reset form fields
      amountInput.value = '';
      refInput.value = '';
      farmerInput.value = '';
      remarksInput.value = '';
      dateInput.value = getTodayString();

      // Refresh views
      loadSingkeAccountView();
      loadDashboard();
    } catch (e) {
      console.error(e);
      Native.showToast(`Failed to record settlement: ${e.message}`);
    }
  }

  // --- MODAL SETTLEMENT HANDLERS ---
  window.openAddSettlementModal = function () {
    document.getElementById('modalSettleId').value = '';
    document.getElementById('modalSettleDate').value = getTodayString();
    document.getElementById('modalSettleAmount').value = '';
    document.getElementById('modalSettleMethod').value = 'Cash';
    document.getElementById('modalSettleRef').value = '';
    document.getElementById('modalSettleFarmer').value = '';
    document.getElementById('modalSettleRemarks').value = '';
    document.getElementById('modalSettlementTitle').textContent = 'Record Singke Payout / Settlement';
    document.getElementById('btnDeleteModalSettlement').style.display = 'none';
    openModal('modalSingkeSettlement');
  };

  window.openEditSettlementModal = async function (settlementId) {
    try {
      const s = await window.liftDeskDB.getSingkeSettlement(settlementId);
      if (!s) {
        Native.showToast('Settlement record not found.');
        return;
      }
      document.getElementById('modalSettleId').value = s.id;
      document.getElementById('modalSettleDate').value = s.date || getTodayString();
      document.getElementById('modalSettleAmount').value = s.amount;
      document.getElementById('modalSettleMethod').value = s.paymentMethod || 'Cash';
      document.getElementById('modalSettleRef').value = s.refNumber || '';
      document.getElementById('modalSettleFarmer').value = s.farmerId || '';
      document.getElementById('modalSettleRemarks').value = s.remarks || '';
      document.getElementById('modalSettlementTitle').textContent = `Edit Settlement (${s.refNumber || s.id})`;
      document.getElementById('btnDeleteModalSettlement').style.display = 'inline-block';
      openModal('modalSingkeSettlement');
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  };

  async function saveModalSettlement() {
    const id = document.getElementById('modalSettleId').value;
    const date = document.getElementById('modalSettleDate').value || getTodayString();
    const amount = parseFloat(document.getElementById('modalSettleAmount').value);
    const paymentMethod = document.getElementById('modalSettleMethod').value;
    const refNumber = document.getElementById('modalSettleRef').value.trim();
    const farmerId = document.getElementById('modalSettleFarmer').value || null;
    const remarks = document.getElementById('modalSettleRemarks').value.trim();

    if (isNaN(amount) || amount <= 0) {
      Native.showToast('Please enter a valid settlement amount.');
      return;
    }

    try {
      if (id) {
        await window.liftDeskDB.updateSingkeSettlement(id, {
          date,
          amount,
          paymentMethod,
          refNumber,
          farmerId,
          remarks
        });
        Native.showToast('Settlement record updated successfully.');
      } else {
        await window.liftDeskDB.addSingkeSettlement({
          date,
          amount,
          paymentMethod,
          refNumber,
          farmerId,
          remarks
        });
        Native.showToast('Settlement to Singke recorded.');
      }

      closeModal('modalSingkeSettlement');
      loadSingkeAccountView();
      loadDashboard();
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  }

  window.confirmDeleteSettlement = async function (settlementId) {
    if (confirm(`Are you sure you want to reverse / delete settlement record ${settlementId}?`)) {
      try {
        await window.liftDeskDB.deleteSingkeSettlement(settlementId);
        Native.showToast('Settlement record deleted.');
        loadSingkeAccountView();
        loadDashboard();
      } catch (e) {
        console.error(e);
        Native.showToast(e.message);
      }
    }
  };

  // --- RENDER SINGKE FULL AUDIT LEDGER TAB ---
  async function renderSingkeLedger() {
    try {
      const startDate = state.singkeFilter.startDate || null;
      const endDate = state.singkeFilter.endDate || null;
      const filterType = state.singkeFilter.ledgerType || 'all';
      const search = (state.singkeFilter.ledgerSearch || '').toLowerCase();

      const ledger = await window.liftDeskDB.getSingkeLedger(startDate, endDate);

      const tbody = document.getElementById('singkeLedgerTbody');
      const empty = document.getElementById('singkeLedgerEmpty');
      const badge = document.getElementById('singkeLedgerCountBadge');

      if (!tbody) return;
      tbody.innerHTML = '';

      // Filter entries
      let filtered = ledger.filter(item => {
        if (filterType !== 'all' && item.type !== filterType) return false;
        if (search) {
          const matchStr = `${item.date} ${item.type} ${item.refNumber} ${item.farmerName} ${item.description} ${item.remarks}`.toLowerCase();
          if (!matchStr.includes(search)) return false;
        }
        return true;
      });

      if (badge) badge.textContent = `${filtered.length} of ${ledger.length} entries`;

      let totalCredit = 0;
      let totalDebit = 0;
      ledger.forEach(i => {
        totalCredit += (i.credit || 0);
        totalDebit += (i.debit || 0);
      });
      const finalBalance = totalCredit - totalDebit;

      const credEl = document.getElementById('singkeLedgerTotalCredit');
      const debEl = document.getElementById('singkeLedgerTotalDebit');
      const balEl = document.getElementById('singkeLedgerFinalBalance');
      if (credEl) credEl.textContent = `₹${formatCurrency(totalCredit)}`;
      if (debEl) debEl.textContent = `₹${formatCurrency(totalDebit)}`;
      if (balEl) balEl.textContent = `₹${formatCurrency(finalBalance)}`;

      if (filtered.length === 0) {
        if (empty) empty.style.display = 'block';
      } else {
        if (empty) empty.style.display = 'none';
        filtered.forEach(entry => {
          const tr = document.createElement('tr');

          let badgeClass = 'badge-credit';
          let badgeLabel = 'LIFTING DUE';
          if (entry.type === 'WANGKHEI_DEDUCTION') {
            badgeClass = 'badge-wangkhei';
            badgeLabel = 'WANGKHEI DEDUCT';
          } else if (entry.type === 'OTHER_SETTLEMENT') {
            badgeClass = 'badge-settlement';
            badgeLabel = 'SETTLEMENT PAY';
          }

          const creditText = entry.credit ? `<span style="color:#1E40AF;font-weight:700;">+₹${formatCurrency(entry.credit)}</span>` : '--';
          const debitText = entry.debit ? `<span style="color:#047857;font-weight:700;">-₹${formatCurrency(entry.debit)}</span>` : '--';
          const balText = `<strong style="color:${entry.balance > 0 ? '#DC2626' : '#16A34A'};">₹${formatCurrency(entry.balance)}</strong>`;

          let actionButtons = '';
          if (entry.type === 'LIFTING_PAYABLE') {
            actionButtons = `
              <button type="button" class="btn btn-outline btn-sm" onclick="window.openEditLiftingRateModal('${entry.sourceId}')" title="Edit Rate & Remarks">Edit</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.viewFarmerAccountingStatement('${entry.farmerId}')" title="Farmer A/C">A/C</button>
            `;
          } else if (entry.type === 'WANGKHEI_DEDUCTION') {
            actionButtons = `
              <button type="button" class="btn btn-outline btn-sm" onclick="window.viewInvoice('${entry.sourceId}')" title="View Sale Invoice">Invoice</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.openEditRemarksModal('sale', '${entry.sourceId}', '${escapeHtml(entry.remarks || '')}', '${entry.refNumber}', 'Wangkhei Store Sale')" title="Edit Remarks">Note</button>
            `;
          } else if (entry.type === 'OTHER_SETTLEMENT') {
            actionButtons = `
              <button type="button" class="btn btn-outline btn-sm" onclick="window.openEditSettlementModal('${entry.sourceId}')" title="Edit Settlement">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="window.confirmDeleteSettlement('${entry.sourceId}')" title="Delete">✕</button>
            `;
          }

          tr.innerHTML = `
            <td>${entry.date}</td>
            <td><span class="ledger-type-badge ${badgeClass}">${badgeLabel}</span></td>
            <td><strong>${entry.refNumber}</strong></td>
            <td>${entry.farmerName ? escapeHtml(entry.farmerName) : '<span style="color:var(--text-muted);">--</span>'}</td>
            <td>${escapeHtml(entry.description)}</td>
            <td style="text-align:right;">${creditText}</td>
            <td style="text-align:right;">${debitText}</td>
            <td style="text-align:right;">${balText}</td>
            <td>
              <span class="remarks-display" onclick="window.openEditRemarksModal('${entry.type === 'LIFTING_PAYABLE' ? 'lifting' : (entry.type === 'WANGKHEI_DEDUCTION' ? 'sale' : 'settlement')}', '${entry.sourceId}', '${escapeHtml(entry.remarks || '')}', '${entry.refNumber}', '${badgeLabel}')" title="Click to edit payment remarks">
                ${entry.remarks ? escapeHtml(entry.remarks) : '<span style="color:var(--text-muted);font-style:italic;">+ Add note</span>'} ✏️
              </span>
            </td>
            <td><div style="display:flex;gap:4px;">${actionButtons}</div></td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error('Error rendering Singke ledger:', e);
    }
  }

  // --- RENDER WANGKHEI STORE SALES TAB ---
  async function renderSingkeWangkhei() {
    try {
      const sales = await window.liftDeskDB.getAllSales();
      const wangkheiSales = sales.filter(s => s.isWangkheiSale || (s.storeName && s.storeName.toLowerCase().includes('wangkhei')));
      wangkheiSales.sort((a, b) => new Date(b.saleDate || 0) - new Date(a.saleDate || 0));

      let totalWeight = 0;
      let totalCages = 0;
      let totalAmount = 0;

      wangkheiSales.forEach(s => {
        totalWeight += (s.totalWeight || 0);
        totalCages += (s.totalCages || 0);
        totalAmount += (s.totalAmount || 0);
      });

      const wtEl = document.getElementById('wangkheiTotalWeight');
      const cagesEl = document.getElementById('wangkheiTotalCages');
      const amtEl = document.getElementById('wangkheiTotalAmount');
      const badge = document.getElementById('wangkheiSalesCountBadge');

      if (wtEl) wtEl.textContent = `${formatKg(totalWeight)} kg`;
      if (cagesEl) cagesEl.textContent = totalCages;
      if (amtEl) amtEl.textContent = `₹${formatCurrency(totalAmount)}`;
      if (badge) badge.textContent = `${wangkheiSales.length} Wangkhei Sales`;

      const tbody = document.getElementById('wangkheiSalesTbody');
      const empty = document.getElementById('wangkheiSalesEmpty');

      if (!tbody) return;
      tbody.innerHTML = '';

      if (wangkheiSales.length === 0) {
        if (empty) empty.style.display = 'block';
      } else {
        if (empty) empty.style.display = 'none';
        wangkheiSales.forEach(s => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${s.invoiceNumber || s.id}</strong></td>
            <td>${s.saleDate}</td>
            <td>${s.farmerName ? escapeHtml(s.farmerName) : '<span style="color:var(--text-muted);">Unlinked</span>'}</td>
            <td><strong>${s.liftingId || '--'}</strong></td>
            <td>${s.totalCages || (s.cages ? s.cages.length : 0)}</td>
            <td><strong>${formatKg(s.totalWeight)} kg</strong></td>
            <td>₹${formatCurrency(s.salesRate)}</td>
            <td style="font-weight:700;color:#047857;">₹${formatCurrency(s.totalAmount)}</td>
            <td>
              <span class="remarks-display" onclick="window.openEditRemarksModal('sale', '${s.id}', '${escapeHtml(s.remarks || '')}', '${s.invoiceNumber || s.id}', 'Wangkhei Store Sale')" title="Click to edit remarks">
                ${s.remarks ? escapeHtml(s.remarks) : '<span style="color:var(--text-muted);font-style:italic;">+ Add note</span>'} ✏️
              </span>
            </td>
            <td>
              <div style="display:flex;gap:4px;">
                <button type="button" class="btn btn-outline btn-sm" onclick="window.viewInvoice('${s.id}')">Invoice</button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error('Error rendering Wangkhei sales tab:', e);
    }
  }

  // --- RENDER FARMER ACCOUNTS TAB ---
  async function renderSingkeFarmers() {
    try {
      const farmers = await window.liftDeskDB.getAllFarmers();
      const search = (state.singkeFilter.farmerSearch || '').toLowerCase();

      const tbody = document.getElementById('farmerAccountsTbody');
      const empty = document.getElementById('farmerAccountsEmpty');
      const badge = document.getElementById('farmerAccountsCountBadge');

      if (!tbody) return;
      tbody.innerHTML = '';

      let filtered = farmers.filter(f => {
        if (search) {
          const match = `${f.name} ${f.phone} ${f.id}`.toLowerCase();
          if (!match.includes(search)) return false;
        }
        return true;
      });

      if (badge) badge.textContent = `${filtered.length} Farmers`;

      if (filtered.length === 0) {
        if (empty) empty.style.display = 'block';
      } else {
        if (empty) empty.style.display = 'none';
        for (const farmer of filtered) {
          const fin = await window.liftDeskDB.getFarmerFinancialSummary(farmer.id);

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>
              <div style="font-weight:700;color:#0F172A;">${escapeHtml(farmer.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);">${farmer.id}</div>
            </td>
            <td>📞 ${escapeHtml(farmer.phone)}</td>
            <td>${fin.totalLiftings}</td>
            <td>${fin.totalBirds}</td>
            <td><strong>${formatKg(fin.totalWeight)} kg</strong></td>
            <td style="font-weight:700;color:#1E40AF;">₹${formatCurrency(fin.totalLiftingAmount)}</td>
            <td style="color:#047857;">-₹${formatCurrency(fin.totalWangkheiDeductions)}</td>
            <td style="color:#6D28D9;">-₹${formatCurrency(fin.totalDirectSettlements)}</td>
            <td style="font-weight:800;color:${fin.remainingDue > 0 ? '#DC2626' : '#16A34A'};">₹${formatCurrency(fin.remainingDue)}</td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button type="button" class="btn btn-outline btn-sm" onclick="window.viewFarmerAccountingStatement('${farmer.id}')" title="Detailed statement for this farmer">
                  Statement
                </button>
                <button type="button" class="btn btn-whatsapp btn-sm" onclick="window.shareFarmerAccountingWhatsApp('${farmer.id}')" title="Send accounting breakdown to farmer via WhatsApp">
                  WhatsApp
                </button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        }
      }
    } catch (e) {
      console.error('Error rendering farmer accounts tab:', e);
    }
  }

  // --- RENDER FORMAL REPORT PREVIEWS ---
  async function renderSingkeReportsPreview() {
    try {
      const typeSelect = document.getElementById('selectReportStatementType');
      const reportType = typeSelect ? typeSelect.value : 'singke_master';

      const titleEl = document.getElementById('reportSheetTitle');
      const subEl = document.getElementById('reportSheetSubtitle');
      const summaryBar = document.getElementById('reportSheetSummaryBar');
      const tbody = document.getElementById('reportSheetTbody');

      if (!tbody) return;
      tbody.innerHTML = '';

      const startDate = state.singkeFilter.startDate || null;
      const endDate = state.singkeFilter.endDate || null;
      const periodLabel = (startDate && endDate) ? `${startDate} to ${endDate}` : (startDate ? `From ${startDate}` : (endDate ? `Up to ${endDate}` : 'All Time'));

      if (reportType === 'singke_master') {
        if (titleEl) titleEl.textContent = 'SINGKE ACCOUNTING & SETTLEMENT STATEMENT';
        if (subEl) subEl.textContent = `Period: ${periodLabel} | Payable to Singke for farmer liftings less Wangkhei store sales & settlements`;

        const summary = await window.liftDeskDB.getSingkeAccountSummary(startDate, endDate);
        if (summaryBar) {
          summaryBar.innerHTML = `
            <div class="report-metric-box">
              <div class="metric-label">Total Farmer Lifting Value</div>
              <div class="metric-value" style="color:#1E40AF;">₹${formatCurrency(summary.totalPayableToSingke)}</div>
              <div class="metric-sub">${summary.liftingsCount} liftings (${formatKg(summary.totalWeightLifted)} kg)</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Wangkhei Store Deductions</div>
              <div class="metric-value" style="color:#047857;">-₹${formatCurrency(summary.totalWangkheiDeductions)}</div>
              <div class="metric-sub">${summary.wangkheiSalesCount} store sales (${formatKg(summary.wangkheiWeightSold)} kg)</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Other Payout Settlements</div>
              <div class="metric-value" style="color:#6D28D9;">-₹${formatCurrency(summary.totalOtherSettlements)}</div>
              <div class="metric-sub">${summary.settlementsCount} settlement payouts</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Final Remaining Due to Singke</div>
              <div class="metric-value" style="color:${summary.remainingDueToSingke > 0 ? '#DC2626' : '#16A34A'};">₹${formatCurrency(summary.remainingDueToSingke)}</div>
              <div class="metric-sub">Account Balance</div>
            </div>
          `;
        }

        const ledger = await window.liftDeskDB.getSingkeLedger(startDate, endDate);
        ledger.forEach(row => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${row.date}</td>
            <td><strong>${row.refNumber}</strong></td>
            <td>${row.type}</td>
            <td>${row.farmerName || '--'}</td>
            <td>${escapeHtml(row.description)}</td>
            <td style="text-align:right;">${row.credit ? `+₹${formatCurrency(row.credit)}` : '--'}</td>
            <td style="text-align:right;">${row.debit ? `-₹${formatCurrency(row.debit)}` : '--'}</td>
            <td style="text-align:right;font-weight:700;">₹${formatCurrency(row.balance)}</td>
            <td>${row.remarks ? escapeHtml(row.remarks) : '--'}</td>
          `;
          tbody.appendChild(tr);
        });

      } else if (reportType === 'farmer_summary') {
        if (titleEl) titleEl.textContent = 'FARMER LIFTING & SINGKE SETTLEMENT ACCOUNTING SUMMARY';
        if (subEl) subEl.textContent = `All Registered Farmers | Single Source of Truth Farmer Master`;

        const farmers = await window.liftDeskDB.getAllFarmers();
        let grandLifting = 0;
        let grandWangkhei = 0;
        let grandSettled = 0;
        let grandDue = 0;

        for (const f of farmers) {
          const fin = await window.liftDeskDB.getFarmerFinancialSummary(f.id);
          grandLifting += fin.totalLiftingAmount;
          grandWangkhei += fin.totalWangkheiDeductions;
          grandSettled += fin.totalDirectSettlements;
          grandDue += fin.remainingDue;

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${escapeHtml(f.name)}</strong></td>
            <td>${f.id}</td>
            <td>${f.phone}</td>
            <td>${fin.totalLiftings} liftings</td>
            <td>${formatKg(fin.totalWeight)} kg (${fin.totalBirds} birds)</td>
            <td style="text-align:right;font-weight:700;color:#1E40AF;">₹${formatCurrency(fin.totalLiftingAmount)}</td>
            <td style="text-align:right;color:#047857;">-₹${formatCurrency(fin.totalWangkheiDeductions)}</td>
            <td style="text-align:right;color:#6D28D9;">-₹${formatCurrency(fin.totalDirectSettlements)}</td>
            <td style="text-align:right;font-weight:800;color:${fin.remainingDue > 0 ? '#DC2626' : '#16A34A'};">₹${formatCurrency(fin.remainingDue)}</td>
          `;
          tbody.appendChild(tr);
        }

        if (summaryBar) {
          summaryBar.innerHTML = `
            <div class="report-metric-box">
              <div class="metric-label">Total Farmer Liftings</div>
              <div class="metric-value" style="color:#1E40AF;">₹${formatCurrency(grandLifting)}</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Wangkhei Store Deducted</div>
              <div class="metric-value" style="color:#047857;">-₹${formatCurrency(grandWangkhei)}</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Direct Settlements</div>
              <div class="metric-value" style="color:#6D28D9;">-₹${formatCurrency(grandSettled)}</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Net Remaining Balance</div>
              <div class="metric-value" style="color:${grandDue > 0 ? '#DC2626' : '#16A34A'};">₹${formatCurrency(grandDue)}</div>
            </div>
          `;
        }

      } else if (reportType === 'wangkhei_store') {
        if (titleEl) titleEl.textContent = 'WANGKHEI STORE DEDUCTION & SALES AUDIT STATEMENT';
        if (subEl) subEl.textContent = `All sales billed to Wangkhei Store (Singke owned) auto-deducted from Singke due`;

        const sales = await window.liftDeskDB.getAllSales();
        const wangkheiSales = sales.filter(s => s.isWangkheiSale || (s.storeName && s.storeName.toLowerCase().includes('wangkhei')));
        let grandWt = 0;
        let grandAmt = 0;

        wangkheiSales.forEach(s => {
          grandWt += (s.totalWeight || 0);
          grandAmt += (s.totalAmount || 0);

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${s.saleDate}</td>
            <td><strong>${s.invoiceNumber || s.id}</strong></td>
            <td>${s.liftingId || '--'}</td>
            <td>${s.farmerName || '--'}</td>
            <td>${s.totalCages || (s.cages ? s.cages.length : 0)} cages</td>
            <td>${formatKg(s.totalWeight)} kg</td>
            <td>₹${formatCurrency(s.salesRate)}</td>
            <td style="text-align:right;font-weight:700;color:#047857;">₹${formatCurrency(s.totalAmount)}</td>
            <td>${s.remarks ? escapeHtml(s.remarks) : '--'}</td>
          `;
          tbody.appendChild(tr);
        });

        if (summaryBar) {
          summaryBar.innerHTML = `
            <div class="report-metric-box">
              <div class="metric-label">Total Wangkhei Sales</div>
              <div class="metric-value">${wangkheiSales.length}</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Total Weight Sold</div>
              <div class="metric-value">${formatKg(grandWt)} kg</div>
            </div>
            <div class="report-metric-box">
              <div class="metric-label">Total Deducted from Singke</div>
              <div class="metric-value" style="color:#047857;">₹${formatCurrency(grandAmt)}</div>
            </div>
          `;
        }
      }
    } catch (e) {
      console.error('Error rendering Singke report preview:', e);
    }
  }

  // --- MODAL FARMER ACCOUNTING STATEMENT ---
  window.viewFarmerAccountingStatement = async function (farmerId) {
    try {
      const rep = await window.liftDeskDB.getFarmerPaymentReport(farmerId);
      if (!rep || !rep.farmer) {
        Native.showToast('Farmer details not found.');
        return;
      }

      document.getElementById('modalStmtFarmerName').textContent = rep.farmer.name;
      document.getElementById('modalStmtFarmerId').textContent = rep.farmer.id;
      document.getElementById('modalStmtFarmerPhone').textContent = rep.farmer.phone;

      document.getElementById('modalStmtRemainingDue').textContent = `₹${formatCurrency(rep.remainingDue)}`;
      document.getElementById('modalStmtTotalLifting').textContent = `₹${formatCurrency(rep.totalLiftingAmount)}`;
      document.getElementById('modalStmtWangkheiDeducted').textContent = `₹${formatCurrency(rep.totalWangkheiDeductions)}`;
      document.getElementById('modalStmtSettled').textContent = `₹${formatCurrency(rep.totalDirectSettlements)}`;

      const tbody = document.getElementById('modalStmtLedgerTbody');
      const empty = document.getElementById('modalStmtEmpty');

      if (tbody) {
        tbody.innerHTML = '';
        if (rep.timeline.length === 0) {
          if (empty) empty.style.display = 'block';
        } else {
          if (empty) empty.style.display = 'none';
          rep.timeline.forEach(item => {
            const tr = document.createElement('tr');
            const plus = item.type === 'LIFTING' ? `<strong style="color:#1E40AF;">+₹${formatCurrency(item.amount)}</strong>` : '--';
            const minus = item.type !== 'LIFTING' ? `<strong style="color:#047857;">-₹${formatCurrency(item.amount)}</strong>` : '--';
            const balanceColor = item.balance > 0 ? '#DC2626' : '#16A34A';

            let typeLabel = 'Lifting Payable';
            if (item.type === 'WANGKHEI_DEDUCTION') typeLabel = 'Wangkhei Store Deduction';
            if (item.type === 'DIRECT_SETTLEMENT') typeLabel = 'Payout Settlement to Singke';

            tr.innerHTML = `
              <td>${item.date}</td>
              <td><strong>${item.ref}</strong></td>
              <td><span style="font-size:12px;font-weight:600;">${typeLabel}</span></td>
              <td>${escapeHtml(item.details)}</td>
              <td style="text-align:right;">${plus}</td>
              <td style="text-align:right;">${minus}</td>
              <td style="text-align:right;font-weight:800;color:${balanceColor};">₹${formatCurrency(item.balance)}</td>
              <td>${item.remarks ? escapeHtml(item.remarks) : '<span style="color:var(--text-muted);">--</span>'}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      }

      // WhatsApp Button for Farmer Statement
      const btnWa = document.getElementById('btnStmtWhatsApp');
      if (btnWa) {
        btnWa.onclick = () => window.shareFarmerAccountingWhatsApp(farmerId);
      }

      // Print Button
      const btnPrint = document.getElementById('btnStmtPrint');
      if (btnPrint) {
        btnPrint.onclick = () => Native.print();
      }

      openModal('modalFarmerAccountingStatement');
    } catch (e) {
      console.error(e);
      Native.showToast(`Error viewing statement: ${e.message}`);
    }
  };

  window.shareFarmerAccountingWhatsApp = async function (farmerId) {
    try {
      const rep = await window.liftDeskDB.getFarmerPaymentReport(farmerId);
      const text = `*MPF LiftDesk - Farmer Accounting Statement*\n\n` +
        `Farmer: *${rep.farmer.name}* (${rep.farmer.id})\n` +
        `Phone: ${rep.farmer.phone}\n` +
        `Payment Handled Through: *Singke*\n` +
        `-----------------------------------------\n` +
        `• Total Lifting Amount: *₹${formatCurrency(rep.totalLiftingAmount)}* (${rep.totalLiftings} liftings, ${formatKg(rep.totalWeight)} kg)\n` +
        `• Wangkhei Store Deductions: *-₹${formatCurrency(rep.totalWangkheiDeductions)}*\n` +
        `• Direct Settlement Payouts: *-₹${formatCurrency(rep.totalDirectSettlements)}*\n` +
        `• *Remaining Payable to Singke: ₹${formatCurrency(rep.remainingDue)}*\n` +
        `-----------------------------------------\n` +
        `Formula: Remaining Due = Total Lifting Amount - Wangkhei Deductions - Settlements\n\n` +
        `Detailed records and audit history available in MPF LiftDesk.`;

      Native.openWhatsApp(rep.farmer.phone, text);
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  };

  // --- MODAL EDIT REMARKS CONTROLLER ---
  window.openEditRemarksModal = function (entityType, entityId, currentRemarks, refText, subText) {
    document.getElementById('editRemarksTargetType').value = entityType;
    document.getElementById('editRemarksTargetId').value = entityId;
    document.getElementById('editRemarksRefDisplay').textContent = refText || entityId;
    document.getElementById('editRemarksSubDisplay').textContent = subText || '';
    document.getElementById('inputEditRemarksText').value = currentRemarks || '';
    openModal('modalEditRemarks');
  };

  async function saveEditedRemarks() {
    const type = document.getElementById('editRemarksTargetType').value;
    const id = document.getElementById('editRemarksTargetId').value;
    const remarks = document.getElementById('inputEditRemarksText').value.trim();

    try {
      if (type === 'lifting') {
        await window.liftDeskDB.updateLiftingRemarks(id, remarks);
      } else if (type === 'sale') {
        await window.liftDeskDB.updateSaleRemarks(id, remarks);
      } else if (type === 'settlement') {
        await window.liftDeskDB.updateSettlementRemarks(id, remarks);
      }

      Native.showToast('Payment remarks updated successfully.');
      closeModal('modalEditRemarks');

      // Refresh whatever view is currently visible
      if (state.currentView === 'viewSingkeAccount') {
        loadSingkeAccountView();
      } else if (state.currentView === 'viewLifting') {
        loadLiftingHistory();
      } else if (state.currentView === 'viewSales') {
        loadSalesInvoices();
      }
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  }

  // --- MODAL EDIT LIFTING RATE & REMARKS ---
  window.openEditLiftingRateModal = async function (liftingId) {
    try {
      const lifting = await window.liftDeskDB.getLifting(liftingId);
      if (!lifting) {
        Native.showToast('Lifting record not found.');
        return;
      }

      document.getElementById('editLiftingId').value = lifting.id;
      document.getElementById('editLiftingFarmerDisplay').textContent = `${lifting.farmerName} (${lifting.id})`;
      document.getElementById('editLiftingStatsDisplay').textContent = `${lifting.liftingDate} | ${lifting.totalCages} cages | ${formatKg(lifting.totalWeight)} kg | ${lifting.totalBirds} birds`;
      document.getElementById('inputEditLiftingRate').value = lifting.liftingRate || '';
      document.getElementById('inputEditLiftingRemarks').value = lifting.remarks || '';

      openModal('modalEditLiftingRate');
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  };

  async function saveEditedLiftingRate() {
    const id = document.getElementById('editLiftingId').value;
    const rate = parseFloat(document.getElementById('inputEditLiftingRate').value);
    const remarks = document.getElementById('inputEditLiftingRemarks').value.trim();

    if (isNaN(rate) || rate < 0) {
      Native.showToast('Please enter a valid rate (₹/kg).');
      return;
    }

    try {
      const updated = await window.liftDeskDB.updateLiftingRateAndRemarks(id, rate, remarks);
      Native.showToast(`Lifting ${id} updated! New total value: ₹${formatCurrency(updated.liftingAmount)}`);
      closeModal('modalEditLiftingRate');

      loadLiftingHistory();
      loadDashboard();
      if (state.currentView === 'viewSingkeAccount') {
        loadSingkeAccountView();
      }
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  }

  // --- EXPORT SINGKE ACCOUNTING TO EXCEL ---
  async function exportSingkeLedgerToExcel() {
    if (typeof XLSX === 'undefined') {
      Native.showToast('Excel library loading, please try again in a moment...');
      return;
    }

    try {
      Native.showToast('Generating Singke Accounting Excel file...');
      const wb = XLSX.utils.book_new();

      // Sheet 1: Master Ledger
      const ledger = await window.liftDeskDB.getSingkeLedger(state.singkeFilter.startDate, state.singkeFilter.endDate);
      const ledgerRows = ledger.map(e => ({
        Date: e.date,
        Type: e.type,
        Reference_Number: e.refNumber,
        Farmer_Or_Entity: e.farmerName || 'Singke / Wangkhei',
        Description: e.description,
        Credit_Payable_Rs: e.credit || 0,
        Debit_Deduction_Rs: e.debit || 0,
        Running_Balance_Due_Rs: e.balance || 0,
        Payment_Remarks: e.remarks || ''
      }));
      const wsLedger = XLSX.utils.json_to_sheet(ledgerRows);
      XLSX.utils.book_append_sheet(wb, wsLedger, 'Singke_Audit_Ledger');

      // Sheet 2: Wangkhei Store Sales
      const sales = await window.liftDeskDB.getAllSales();
      const wangkheiSales = sales.filter(s => s.isWangkheiSale || (s.storeName && s.storeName.toLowerCase().includes('wangkhei')));
      const wkRows = wangkheiSales.map(s => ({
        Invoice_Number: s.invoiceNumber || s.id,
        Date: s.saleDate,
        Lifting_Ref: s.liftingId,
        Farmer: s.farmerName,
        Cages: s.totalCages || (s.cages ? s.cages.length : 0),
        Weight_Kg: s.totalWeight,
        Sales_Rate_Rs: s.salesRate,
        Deducted_Amount_Rs: s.totalAmount,
        Remarks: s.remarks || ''
      }));
      const wsWk = XLSX.utils.json_to_sheet(wkRows);
      XLSX.utils.book_append_sheet(wb, wsWk, 'Wangkhei_Store_Sales');

      // Sheet 3: Direct Settlement Records
      const settlements = await window.liftDeskDB.getSingkeSettlements(state.singkeFilter.startDate, state.singkeFilter.endDate);
      const setRows = settlements.map(s => ({
        Date: s.date,
        Reference_Number: s.refNumber || s.id,
        Payment_Method: s.paymentMethod,
        Farmer_Linked: s.farmerName || 'General',
        Amount_Paid_Rs: s.amount,
        Remarks: s.remarks || ''
      }));
      const wsSet = XLSX.utils.json_to_sheet(setRows);
      XLSX.utils.book_append_sheet(wb, wsSet, 'Settlement_Payouts');

      // Sheet 4: Farmer Balances
      const farmers = await window.liftDeskDB.getAllFarmers();
      const farmerRows = [];
      for (const f of farmers) {
        const fin = await window.liftDeskDB.getFarmerFinancialSummary(f.id);
        farmerRows.push({
          Farmer_ID: f.id,
          Farmer_Name: f.name,
          Phone: f.phone,
          Liftings_Count: fin.totalLiftings,
          Total_Weight_Kg: fin.totalWeight,
          Total_Birds: fin.totalBirds,
          Total_Lifting_Value_Rs: fin.totalLiftingAmount,
          Wangkhei_Deducted_Rs: fin.totalWangkheiDeductions,
          Direct_Settled_Rs: fin.totalDirectSettlements,
          Remaining_Due_Rs: fin.remainingDue
        });
      }
      const wsFarmers = XLSX.utils.json_to_sheet(farmerRows);
      XLSX.utils.book_append_sheet(wb, wsFarmers, 'Farmer_Accounting_Balances');

      const fileName = `MPF_Singke_Wangkhei_Accounting_${getTodayString()}.xlsx`;
      XLSX.writeFile(wb, fileName);
      Native.showToast(`Exported: ${fileName}`);
    } catch (e) {
      console.error(e);
      Native.showToast(`Excel export failed: ${e.message}`);
    }
  }

  // --- WHATSAPP SHARE SINGKE STATEMENT ---
  async function shareSingkeMasterWhatsApp() {
    try {
      const summary = await window.liftDeskDB.getSingkeAccountSummary(state.singkeFilter.startDate, state.singkeFilter.endDate);
      const text = `*MPF LiftDesk - Singke Settlement Statement*\n\n` +
        `Accounting Period: ${state.singkeFilter.startDate ? state.singkeFilter.startDate : 'Start'} to ${state.singkeFilter.endDate ? state.singkeFilter.endDate : 'Today'}\n` +
        `Account Holder: *Singke*\n` +
        `-----------------------------------------\n` +
        `1. Farmer Liftings Value: *₹${formatCurrency(summary.totalPayableToSingke)}*\n` +
        `   (${summary.liftingsCount} liftings, ${formatKg(summary.totalWeightLifted)} kg)\n\n` +
        `2. Wangkhei Store Deductions: *-₹${formatCurrency(summary.totalWangkheiDeductions)}*\n` +
        `   (${summary.wangkheiSalesCount} store sales auto-deducted)\n\n` +
        `3. Direct Settlement Payouts: *-₹${formatCurrency(summary.totalOtherSettlements)}*\n` +
        `   (${summary.settlementsCount} payments recorded)\n` +
        `-----------------------------------------\n` +
        `*FINAL REMAINING DUE TO SINGKE: ₹${formatCurrency(summary.remainingDueToSingke)}*\n` +
        `-----------------------------------------\n` +
        `Generated via MPF LiftDesk App.`;

      Native.openWhatsApp('', text);
    } catch (e) {
      console.error(e);
      Native.showToast(e.message);
    }
  }

  // --- 8. SETTINGS & DATA CONTROLLER ---
  async function loadSettingsView() {
    const pin = await window.liftDeskDB.getSetting('app_pin');
    const badge = document.getElementById('pinStatusBadge');
    const btnLock = document.getElementById('btnLockNow');
    const btnRemove = document.getElementById('btnRemovePin');
    const headerLock = document.getElementById('btnHeaderLock');

    if (pin) {
      badge.textContent = 'Active (4-Digit)';
      badge.style.background = '#DCFCE7';
      badge.style.color = '#15803D';
      btnLock.style.display = 'inline-flex';
      btnRemove.style.display = 'inline-flex';
      headerLock.style.display = 'flex';
      state.pinHash = pin;
    } else {
      badge.textContent = 'Disabled';
      badge.style.background = '#F1F5F9';
      badge.style.color = '#64748B';
      btnLock.style.display = 'none';
      btnRemove.style.display = 'none';
      headerLock.style.display = 'none';
      state.pinHash = null;
    }
  }

  // EXCEL EXPORT (Full multi-table .xlsx)
  async function exportAllToExcel() {
    if (typeof XLSX === 'undefined') {
      Native.showToast('Excel exporter library loading...');
      return;
    }

    try {
      Native.showToast('Preparing Excel workbook...');
      const fullData = await window.liftDeskDB.exportFullDatabaseJSON();

      const wb = XLSX.utils.book_new();

      // Sheet 1: Farmers
      const farmersWs = XLSX.utils.json_to_sheet(fullData.data.farmers || []);
      XLSX.utils.book_append_sheet(wb, farmersWs, 'Farmers_Master');

      // Sheet 2: Liftings
      const liftingsWs = XLSX.utils.json_to_sheet(fullData.data.liftings || []);
      XLSX.utils.book_append_sheet(wb, liftingsWs, 'Liftings');

      // Sheet 3: Cages
      const cagesWs = XLSX.utils.json_to_sheet(fullData.data.cages || []);
      XLSX.utils.book_append_sheet(wb, cagesWs, 'Cages');

      // Sheet 4: Stores
      const storesWs = XLSX.utils.json_to_sheet(fullData.data.stores || []);
      XLSX.utils.book_append_sheet(wb, storesWs, 'Stores_Master');

      // Sheet 5: Sales
      const salesWs = XLSX.utils.json_to_sheet(fullData.data.sales || []);
      XLSX.utils.book_append_sheet(wb, salesWs, 'Store_Sales');

      // Sheet 6: Payments
      const paymentsWs = XLSX.utils.json_to_sheet(fullData.data.payments || []);
      XLSX.utils.book_append_sheet(wb, paymentsWs, 'Payments_Ledger');

      // Sheet 7: Singke Settlements
      const settlementsWs = XLSX.utils.json_to_sheet(fullData.data.singke_settlements || []);
      XLSX.utils.book_append_sheet(wb, settlementsWs, 'Singke_Settlements');

      // Sheet 8: Singke Master Ledger
      const singkeLedger = await window.liftDeskDB.getSingkeLedger();
      const ledgerExportRows = singkeLedger.map(entry => ({
        Date: entry.date,
        Type: entry.type,
        Reference: entry.refNumber,
        Farmer_Or_Store: entry.farmerName || 'Singke / Wangkhei',
        Description: entry.description,
        Weight_Kg: entry.weight || '',
        Rate_Per_Kg: entry.rate || '',
        Payable_Credit: entry.credit || 0,
        Deduction_Debit: entry.debit || 0,
        Remaining_Due_Balance: entry.balance || 0,
        Payment_Remarks: entry.remarks || ''
      }));
      const singkeWs = XLSX.utils.json_to_sheet(ledgerExportRows);
      XLSX.utils.book_append_sheet(wb, singkeWs, 'Singke_Ledger');

      const fileName = `MPF_LiftDesk_Export_${getTodayString()}.xlsx`;
      XLSX.writeFile(wb, fileName);
      Native.showToast(`Exported successfully: ${fileName}`);
    } catch (e) {
      console.error(e);
      Native.showToast(`Excel export failed: ${e.message}`);
    }
  }

  // EXCEL IMPORT (.xlsx file reader & safe merge)
  async function importFromExcelFile(file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') {
      Native.showToast('Excel library not ready.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        let farmersImported = 0;
        let storesImported = 0;

        // Import Farmers Sheet if present
        if (workbook.SheetNames.includes('Farmers_Master')) {
          const sheet = workbook.Sheets['Farmers_Master'];
          const rows = XLSX.utils.sheet_to_json(sheet);
          for (const row of rows) {
            if (row.name && row.phone) {
              const existing = await window.liftDeskDB.getFarmer(row.id);
              if (!existing) {
                await window.liftDeskDB.addFarmer(row.name, row.phone);
                farmersImported++;
              }
            }
          }
        }

        // Import Stores Sheet if present
        if (workbook.SheetNames.includes('Stores_Master')) {
          const sheet = workbook.Sheets['Stores_Master'];
          const rows = XLSX.utils.sheet_to_json(sheet);
          for (const row of rows) {
            if (row.name && row.phone) {
              const existing = await window.liftDeskDB.getStoreByName(row.name);
              if (!existing) {
                await window.liftDeskDB.addStore(row.name, row.phone, row.openingDue || 0);
                storesImported++;
              }
            }
          }
        }

        Native.showToast(`Import completed: ${farmersImported} new farmers, ${storesImported} new stores.`);
        loadFarmersList();
        loadStoresList();
      } catch (err) {
        console.error(err);
        Native.showToast(`Import error: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // JSON BACKUP & RESTORE
  async function exportJSONBackup() {
    const data = await window.liftDeskDB.exportFullDatabaseJSON();
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MPF_LiftDesk_Backup_${getTodayString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Native.showToast('JSON backup downloaded.');
  }

  async function restoreJSONBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const obj = JSON.parse(e.target.result);
        if (confirm('Restore will replace the current local database with this backup. Continue?')) {
          await window.liftDeskDB.restoreFullDatabaseJSON(obj);
          Native.showToast('Database restored successfully.');
          loadDashboard();
          loadSettingsView();
        }
      } catch (err) {
        Native.showToast(`Invalid backup file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  async function factoryReset() {
    if (confirm('DANGER: This will delete ALL local data in MPF LiftDesk. Are you sure?')) {
      if (confirm('CONFIRM AGAIN: All liftings, cages, sales, stores, and farmers will be wiped clean.')) {
        await window.liftDeskDB.clearAllData();
        Native.showToast('All application data has been wiped clean.');
        loadDashboard();
        loadSettingsView();
      }
    }
  }

  // --- 9. PIN SECURITY CONTROLLER ---
  function lockApp() {
    state.pinLocked = true;
    state.enteredPin = '';
    updatePinDots();
    document.getElementById('pinErrorMessage').textContent = '';
    document.getElementById('pinLockOverlay').style.display = 'flex';
  }

  function unlockApp() {
    state.pinLocked = false;
    document.getElementById('pinLockOverlay').style.display = 'none';
  }

  function updatePinDots() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`pindot${i}`);
      if (i < state.enteredPin.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    }
  }

  async function checkEnteredPin() {
    if (state.enteredPin === state.pinHash) {
      unlockApp();
      Native.showToast('Unlocked.');
    } else {
      document.getElementById('pinErrorMessage').textContent = 'Incorrect PIN. Try again.';
      state.enteredPin = '';
      updatePinDots();
    }
  }

  function handlePinPadKey(key) {
    if (state.enteredPin.length < 4) {
      state.enteredPin += key;
      updatePinDots();
      if (state.enteredPin.length === 4) {
        setTimeout(checkEnteredPin, 100);
      }
    }
  }

  // --- TAB SWITCHER HELPERS ---
  function switchLiftingTab(tab) {
    const btnNew = document.getElementById('tabLiftingNew');
    const btnHist = document.getElementById('tabLiftingHistory');
    const panelNew = document.getElementById('panelLiftingNew');
    const panelHist = document.getElementById('panelLiftingHistory');

    if (tab === 'new') {
      btnNew.classList.add('active');
      btnHist.classList.remove('active');
      panelNew.style.display = 'block';
      panelHist.style.display = 'none';
    } else {
      btnHist.classList.add('active');
      btnNew.classList.remove('active');
      panelHist.style.display = 'block';
      panelNew.style.display = 'none';
      loadLiftingHistory();
    }
  }

  function switchSalesTab(tab) {
    const btnNew = document.getElementById('tabSalesNew');
    const btnHist = document.getElementById('tabSalesHistory');
    const panelNew = document.getElementById('panelSalesNew');
    const panelHist = document.getElementById('panelSalesHistory');

    if (tab === 'new') {
      btnNew.classList.add('active');
      btnHist.classList.remove('active');
      panelNew.style.display = 'block';
      panelHist.style.display = 'none';
    } else {
      btnHist.classList.add('active');
      btnNew.classList.remove('active');
      panelHist.style.display = 'block';
      panelNew.style.display = 'none';
      loadSalesInvoices();
    }
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- INITIALIZATION & EVENT BINDINGS ---
  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Navigation Events (Bound immediately and synchronously)
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (view) navigateTo(view);
      });
    });

    // 2. Start Clock
    startClock();

    // 3. Initialize Database safely without blocking UI
    try {
      await window.liftDeskDB.init();
      console.log('MPF LiftDesk IndexedDB initialized.');
      const savedPin = await window.liftDeskDB.getSetting('app_pin');
      if (savedPin) {
        state.pinHash = savedPin;
        lockApp();
      }
    } catch (e) {
      console.error('Database/Security initialization error:', e);
    }

    // Quick Actions on Dashboard
    document.getElementById('qaNewLifting').onclick = () => {
      navigateTo('viewLifting');
      switchLiftingTab('new');
    };
    document.getElementById('qaNewSale').onclick = () => {
      navigateTo('viewSales');
      switchSalesTab('new');
    };
    document.getElementById('qaFarmers').onclick = () => {
      navigateTo('viewFarmers');
    };
    document.getElementById('btnRefreshDashboard').onclick = loadDashboard;

    // Header Lock
    document.getElementById('btnHeaderLock').onclick = lockApp;

    // Lifting Tab Switcher
    document.getElementById('tabLiftingNew').onclick = () => switchLiftingTab('new');
    document.getElementById('tabLiftingHistory').onclick = () => switchLiftingTab('history');

    // Lifting Form Actions
    document.getElementById('btnOpenFarmerSelector').onclick = openFarmerSelectorDialog;
    document.getElementById('btnChangeFarmer').onclick = openFarmerSelectorDialog;
    document.getElementById('btnQuickRegisterFromLifting').onclick = () => {
      document.getElementById('modalFarmerId').value = '';
      document.getElementById('modalFarmerName').value = '';
      document.getElementById('modalFarmerPhone').value = '';
      document.getElementById('farmerModalTitle').textContent = 'Register New Farmer';
      openModal('modalFarmerRegister');
    };
    document.getElementById('btnAddCageToList').onclick = addCageToCurrentLifting;
    document.getElementById('btnSaveLifting').onclick = saveCurrentLifting;
    document.getElementById('btnResetLiftingForm').onclick = resetLiftingForm;

    // Cage Inputs Keyboard Enter Helper
    document.getElementById('inputCageBirds').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCageToCurrentLifting();
      }
    });

    // Farmer Master Search & Pagination
    const farmerSearchInput = document.getElementById('inputFarmerSearch');
    const farmerSearchClear = document.getElementById('btnFarmerSearchClear');
    let farmerSearchTimer = null;

    farmerSearchInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (q) {
        farmerSearchClear.classList.add('visible');
      } else {
        farmerSearchClear.classList.remove('visible');
      }
      clearTimeout(farmerSearchTimer);
      farmerSearchTimer = setTimeout(() => {
        state.farmerSearchQuery = q;
        state.farmerPage = 1;
        loadFarmersList();
      }, 200);
    });

    farmerSearchClear.onclick = () => {
      farmerSearchInput.value = '';
      farmerSearchClear.classList.remove('visible');
      state.farmerSearchQuery = '';
      state.farmerPage = 1;
      loadFarmersList();
    };

    document.getElementById('btnFarmerPrevPage').onclick = () => {
      if (state.farmerPage > 1) {
        state.farmerPage--;
        loadFarmersList();
      }
    };
    document.getElementById('btnFarmerNextPage').onclick = () => {
      state.farmerPage++;
      loadFarmersList();
    };

    document.getElementById('btnOpenNewFarmerModal').onclick = () => {
      document.getElementById('modalFarmerId').value = '';
      document.getElementById('modalFarmerName').value = '';
      document.getElementById('modalFarmerPhone').value = '';
      document.getElementById('farmerModalTitle').textContent = 'Register New Farmer';
      openModal('modalFarmerRegister');
    };
    document.getElementById('btnSaveFarmerModal').onclick = saveFarmerFromModal;

    // Modal Farmer Selector Search
    const modalFarmerSearchInput = document.getElementById('inputModalFarmerSearch');
    modalFarmerSearchInput.addEventListener('input', (e) => {
      searchModalFarmers(e.target.value);
    });
    document.getElementById('btnModalCreateNewFarmer').onclick = () => {
      closeModal('modalFarmerSelector');
      document.getElementById('modalFarmerId').value = '';
      document.getElementById('modalFarmerName').value = '';
      document.getElementById('modalFarmerPhone').value = '';
      document.getElementById('farmerModalTitle').textContent = 'Register New Farmer';
      openModal('modalFarmerRegister');
    };

    // Sales Tab Switcher
    document.getElementById('tabSalesNew').onclick = () => switchSalesTab('new');
    document.getElementById('tabSalesHistory').onclick = () => switchSalesTab('history');

    // Sales Form Actions
    document.getElementById('selectSaleStore').addEventListener('change', (e) => {
      onSaleStoreSelected(e.target.value);
    });

    document.getElementById('selectSaleLifting').addEventListener('change', (e) => {
      onSaleLiftingSelected(e.target.value);
    });

    const btnSelectAllCages = document.getElementById('btnSaleSelectAllCages');
    if (btnSelectAllCages) {
      btnSelectAllCages.onclick = () => {
        const available = state.saleAvailableCages || [];
        if (available.length === 0) return;
        state.saleSelectedCages = available.map(c => ({
          cageId: c.id,
          cageNumber: c.cageNumber,
          birdCount: c.birdCount || 0,
          originalWeight: c.weight,
          weight: c.weight
        }));
        renderSaleAvailableCagesChips();
        renderSaleSelectedCagesTable();
        updateSaleCalculations();
      };
    }

    const btnClearCages = document.getElementById('btnSaleClearCages');
    if (btnClearCages) {
      btnClearCages.onclick = () => {
        state.saleSelectedCages = [];
        renderSaleAvailableCagesChips();
        renderSaleSelectedCagesTable();
        updateSaleCalculations();
      };
    }

    const btnResetAllWeights = document.getElementById('btnResetAllBilledWeights');
    if (btnResetAllWeights) {
      btnResetAllWeights.onclick = () => {
        (state.saleSelectedCages || []).forEach(c => {
          c.weight = c.originalWeight;
        });
        renderSaleSelectedCagesTable();
        updateSaleCalculations();
      };
    }

    document.getElementById('inputSaleRate').addEventListener('input', updateSaleCalculations);
    document.getElementById('inputSalePaidAmount').addEventListener('input', updateSaleCalculations);
    document.getElementById('btnSaveSale').onclick = saveSaleForm;
    document.getElementById('btnResetSaleForm').onclick = resetSaleForm;
    document.getElementById('btnQuickAddStoreFromSale').onclick = () => {
      document.getElementById('modalStoreId').value = '';
      document.getElementById('modalStoreName').value = '';
      document.getElementById('modalStorePhone').value = '';
      document.getElementById('modalStoreOpeningDue').value = '';
      document.getElementById('storeModalTitle').textContent = 'Add New Store';
      openModal('modalStore');
    };

    // Stores Actions
    document.getElementById('btnOpenNewStoreModal').onclick = () => {
      document.getElementById('modalStoreId').value = '';
      document.getElementById('modalStoreName').value = '';
      document.getElementById('modalStorePhone').value = '';
      document.getElementById('modalStoreOpeningDue').value = '';
      document.getElementById('storeModalTitle').textContent = 'Add New Store';
      openModal('modalStore');
    };
    document.getElementById('btnSaveStoreModal').onclick = saveStoreFromModal;
    document.getElementById('inputStoreSearch').addEventListener('input', loadStoresList);

    // Lifting Form Live Rate Calculation
    const inputLiftingRateEl = document.getElementById('inputLiftingRate');
    if (inputLiftingRateEl) {
      inputLiftingRateEl.addEventListener('input', renderCurrentCagesList);
    }

    // Singke & Wangkhei Accounting Actions
    const btnDashGoSingke = document.getElementById('btnDashGoSingke');
    if (btnDashGoSingke) {
      btnDashGoSingke.onclick = () => {
        navigateTo('viewSingkeAccount');
        switchSingkeTab('summary');
      };
    }

    const btnDashRecordSettlement = document.getElementById('btnDashRecordSettlement');
    if (btnDashRecordSettlement) {
      btnDashRecordSettlement.onclick = () => window.openAddSettlementModal();
    }

    const qaSingkeAccount = document.getElementById('qaSingkeAccount');
    if (qaSingkeAccount) {
      qaSingkeAccount.onclick = () => {
        navigateTo('viewSingkeAccount');
        switchSingkeTab('summary');
      };
    }

    // Singke Tab Switchers
    const tabSingkeSummary = document.getElementById('tabSingkeSummary');
    if (tabSingkeSummary) tabSingkeSummary.onclick = () => switchSingkeTab('summary');
    const tabSingkeLedger = document.getElementById('tabSingkeLedger');
    if (tabSingkeLedger) tabSingkeLedger.onclick = () => switchSingkeTab('ledger');
    const tabSingkeWangkhei = document.getElementById('tabSingkeWangkhei');
    if (tabSingkeWangkhei) tabSingkeWangkhei.onclick = () => switchSingkeTab('wangkhei');
    const tabSingkeFarmers = document.getElementById('tabSingkeFarmers');
    if (tabSingkeFarmers) tabSingkeFarmers.onclick = () => switchSingkeTab('farmers');
    const tabSingkeReports = document.getElementById('tabSingkeReports');
    if (tabSingkeReports) tabSingkeReports.onclick = () => switchSingkeTab('reports');

    // Singke Date Filters
    const btnApplySingkeDateFilter = document.getElementById('btnApplySingkeDateFilter');
    if (btnApplySingkeDateFilter) {
      btnApplySingkeDateFilter.onclick = () => {
        state.singkeFilter.startDate = document.getElementById('singkeDateStart').value || '';
        state.singkeFilter.endDate = document.getElementById('singkeDateEnd').value || '';
        switchSingkeTab(state.singkeFilter.activeTab || 'summary');
      };
    }

    const btnSingkeQuickAll = document.getElementById('btnSingkeQuickAll');
    if (btnSingkeQuickAll) {
      btnSingkeQuickAll.onclick = () => {
        state.singkeFilter.startDate = '';
        state.singkeFilter.endDate = '';
        document.getElementById('singkeDateStart').value = '';
        document.getElementById('singkeDateEnd').value = '';
        switchSingkeTab(state.singkeFilter.activeTab || 'summary');
      };
    }

    const btnSingkeQuickMonth = document.getElementById('btnSingkeQuickMonth');
    if (btnSingkeQuickMonth) {
      btnSingkeQuickMonth.onclick = () => {
        const start = getFirstDayOfMonthString();
        const end = getTodayString();
        state.singkeFilter.startDate = start;
        state.singkeFilter.endDate = end;
        document.getElementById('singkeDateStart').value = start;
        document.getElementById('singkeDateEnd').value = end;
        switchSingkeTab(state.singkeFilter.activeTab || 'summary');
      };
    }

    const btnSingkeQuickToday = document.getElementById('btnSingkeQuickToday');
    if (btnSingkeQuickToday) {
      btnSingkeQuickToday.onclick = () => {
        const today = getTodayString();
        state.singkeFilter.startDate = today;
        state.singkeFilter.endDate = today;
        document.getElementById('singkeDateStart').value = today;
        document.getElementById('singkeDateEnd').value = today;
        switchSingkeTab(state.singkeFilter.activeTab || 'summary');
      };
    }

    // Quick Settlement Form
    const btnSubmitQuickSettlement = document.getElementById('btnSubmitQuickSettlement');
    if (btnSubmitQuickSettlement) {
      btnSubmitQuickSettlement.onclick = saveQuickSettlement;
    }
    const formSingkeQuickSettlement = document.getElementById('formSingkeQuickSettlement');
    if (formSingkeQuickSettlement) {
      formSingkeQuickSettlement.onsubmit = (e) => {
        e.preventDefault();
        saveQuickSettlement();
      };
    }

    const btnOpenAddSettlementModal = document.getElementById('btnOpenAddSettlementModal');
    if (btnOpenAddSettlementModal) {
      btnOpenAddSettlementModal.onclick = () => window.openAddSettlementModal();
    }

    // Singke Ledger Filter & Search
    const singkeLedgerFilterType = document.getElementById('singkeLedgerFilterType');
    if (singkeLedgerFilterType) {
      singkeLedgerFilterType.addEventListener('change', (e) => {
        state.singkeFilter.ledgerType = e.target.value;
        renderSingkeLedger();
      });
    }

    const singkeLedgerSearch = document.getElementById('singkeLedgerSearch');
    if (singkeLedgerSearch) {
      singkeLedgerSearch.addEventListener('input', (e) => {
        state.singkeFilter.ledgerSearch = e.target.value;
        renderSingkeLedger();
      });
    }

    const btnSingkeExportExcel = document.getElementById('btnSingkeExportExcel');
    if (btnSingkeExportExcel) btnSingkeExportExcel.onclick = exportSingkeLedgerToExcel;

    const btnSingkePrintReport = document.getElementById('btnSingkePrintReport');
    if (btnSingkePrintReport) btnSingkePrintReport.onclick = () => Native.print();

    const btnSingkeShareWhatsApp = document.getElementById('btnSingkeShareWhatsApp');
    if (btnSingkeShareWhatsApp) btnSingkeShareWhatsApp.onclick = shareSingkeMasterWhatsApp;

    // Wangkhei Store Actions
    const btnNewWangkheiSale = document.getElementById('btnNewWangkheiSale');
    if (btnNewWangkheiSale) {
      btnNewWangkheiSale.onclick = async () => {
        navigateTo('viewSales');
        switchSalesTab('new');
        // Auto-select first Wangkhei store in selectSaleStore
        const stores = await window.liftDeskDB.getAllStores();
        const wangkheiStore = stores.find(s => s.name && s.name.toLowerCase().includes('wangkhei'));
        if (wangkheiStore) {
          const selectStore = document.getElementById('selectSaleStore');
          if (selectStore) {
            selectStore.value = wangkheiStore.id;
            onSaleStoreSelected(wangkheiStore.id);
          }
        }
      };
    }

    // Farmer Accounts Search
    const inputFarmerAccountSearch = document.getElementById('inputFarmerAccountSearch');
    if (inputFarmerAccountSearch) {
      inputFarmerAccountSearch.addEventListener('input', (e) => {
        state.singkeFilter.farmerSearch = e.target.value;
        renderSingkeFarmers();
      });
    }

    // Reports Actions in Singke Module
    const selectReportStatementType = document.getElementById('selectReportStatementType');
    if (selectReportStatementType) {
      selectReportStatementType.addEventListener('change', renderSingkeReportsPreview);
    }
    const btnGenerateReportPreview = document.getElementById('btnGenerateReportPreview');
    if (btnGenerateReportPreview) {
      btnGenerateReportPreview.onclick = renderSingkeReportsPreview;
    }
    const btnReportActionPrint = document.getElementById('btnReportActionPrint');
    if (btnReportActionPrint) btnReportActionPrint.onclick = () => Native.print();
    const btnReportActionWhatsApp = document.getElementById('btnReportActionWhatsApp');
    if (btnReportActionWhatsApp) btnReportActionWhatsApp.onclick = shareSingkeMasterWhatsApp;
    const btnReportActionExcel = document.getElementById('btnReportActionExcel');
    if (btnReportActionExcel) btnReportActionExcel.onclick = exportSingkeLedgerToExcel;

    // Modal Actions
    const btnSaveModalSettlement = document.getElementById('btnSaveModalSettlement');
    if (btnSaveModalSettlement) btnSaveModalSettlement.onclick = saveModalSettlement;

    const btnDeleteModalSettlement = document.getElementById('btnDeleteModalSettlement');
    if (btnDeleteModalSettlement) {
      btnDeleteModalSettlement.onclick = () => {
        const id = document.getElementById('modalSettleId').value;
        if (id) {
          closeModal('modalSingkeSettlement');
          window.confirmDeleteSettlement(id);
        }
      };
    }

    const btnSaveEditedRemarks = document.getElementById('btnSaveEditedRemarks');
    if (btnSaveEditedRemarks) btnSaveEditedRemarks.onclick = saveEditedRemarks;

    const btnSaveEditedLiftingRate = document.getElementById('btnSaveEditedLiftingRate');
    if (btnSaveEditedLiftingRate) btnSaveEditedLiftingRate.onclick = saveEditedLiftingRate;

    // Ledger Actions
    document.getElementById('btnSavePayment').onclick = saveDirectPayment;

    // Reports Actions
    document.getElementById('btnApplyAccountingFilter').onclick = loadAccountingView;
    document.getElementById('selectAccountingPeriod').addEventListener('change', loadAccountingView);
    document.getElementById('btnPrintAccountingReport').onclick = () => Native.print();
    document.getElementById('btnShareAccountingWhatsApp').onclick = async () => {
      const summary = await window.liftDeskDB.getAccountingSummary();
      const text = `*MPF LiftDesk - Business Statement*\n\n` +
        `Total Sales: ₹${formatCurrency(summary.totalSalesIncome)}\n` +
        `Total Payments Received: ₹${formatCurrency(summary.totalPaymentsReceived)}\n` +
        `Net Store Outstanding: ₹${formatCurrency(summary.totalOutstanding)}\n\n` +
        `Total Lifting Volume: ${formatKg(summary.totalLiftingWeight)} kg\n` +
        `Total Birds: ${summary.totalLiftingBirds}\n` +
        `Total Cages: ${summary.totalCagesLifted}`;
      Native.openWhatsApp('', text);
    };

    // Settings Actions
    document.getElementById('btnExportExcel').onclick = exportAllToExcel;
    document.getElementById('fileImportExcel').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importFromExcelFile(file);
      e.target.value = '';
    });
    document.getElementById('btnExportJSON').onclick = exportJSONBackup;
    document.getElementById('fileRestoreJSON').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) restoreJSONBackup(file);
      e.target.value = '';
    });
    document.getElementById('btnFactoryReset').onclick = factoryReset;

    // PIN Setup Actions
    document.getElementById('btnConfigurePin').onclick = () => {
      document.getElementById('inputNewPin').value = '';
      document.getElementById('inputConfirmPin').value = '';
      openModal('modalPinSetup');
    };
    document.getElementById('btnSaveNewPin').onclick = async () => {
      const pin1 = document.getElementById('inputNewPin').value;
      const pin2 = document.getElementById('inputConfirmPin').value;
      if (pin1.length !== 4 || isNaN(parseInt(pin1, 10))) {
        Native.showToast('PIN must be exactly 4 digits.');
        return;
      }
      if (pin1 !== pin2) {
        Native.showToast('PINs do not match.');
        return;
      }
      await window.liftDeskDB.setSetting('app_pin', pin1);
      state.pinHash = pin1;
      Native.showToast('PIN saved successfully.');
      closeModal('modalPinSetup');
      loadSettingsView();
    };
    document.getElementById('btnRemovePin').onclick = async () => {
      if (confirm('Remove PIN protection?')) {
        await window.liftDeskDB.setSetting('app_pin', null);
        state.pinHash = null;
        Native.showToast('PIN removed.');
        loadSettingsView();
      }
    };
    document.getElementById('btnLockNow').onclick = lockApp;

    // PIN Pad Keys
    document.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        if (key !== undefined) {
          handlePinPadKey(key);
        } else if (action === 'clear') {
          state.enteredPin = '';
          updatePinDots();
        } else if (action === 'delete') {
          state.enteredPin = state.enteredPin.slice(0, -1);
          updatePinDots();
        }
      });
    });

    // Close Modal by Backdrop or [data-close]
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        closeModal(modalId);
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });

    // Initialize Dashboard Filter
    initDashboardActivityFilter();

    // Initial Dashboard Load
    loadDashboard();
  });

})();
