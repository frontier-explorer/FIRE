/**
 * ===============================================================
 * アプリケーション エントリポイント
 * ===============================================================
 * タブ定義・タブ切り替え制御・初期化処理・設定の保存/読込ボタンの
 * 配線を行う。DOMContentLoaded 時に自動的に起動する。
 * ===============================================================
 */
(function () {
  'use strict';
  const { createElement, showToast } = window.FireUiHelpers;

  // タブ定義: id・表示名・描画関数（appData, onChange を受け取る）
  const TABS = [
    { id: 'basic', label: '基本設定', render: window.FireUiTabs.renderTabBasic },
    { id: 'stocks', label: '保有銘柄', render: window.FireUiTabs.renderTabStocks },
    { id: 'soukan', label: '相関係数', render: window.FireUiTabs.renderTabSoukan },
    { id: 'lifecost', label: '生活費', render: window.FireUiTabs.renderTabLifeCost },
    { id: 'income', label: '収入', render: window.FireUiTabs.renderTabIncome },
    { id: 'tuika', label: '追加投資', render: window.FireUiTabs.renderTabTuika },
    { id: 'bigexpense', label: '大きな出費', render: window.FireUiTabs.renderTabBigExpense },
    { id: 'tax', label: '税率', render: window.FireUiTabs.renderTabTax },
    { id: 'fx', label: '為替', render: window.FireUiTabs.renderTabFx },
    { id: 'dividend', label: '配当', render: window.FireUiTabs.renderTabDividend },
    { id: 'cashbuffer', label: '現金/国債バッファ', render: window.FireUiTabs.renderTabCashBuffer },
    { id: 'ideco', label: 'iDeCo', render: window.FireUiTabs.renderTabIdeco },
    { id: 'bonds', label: '債券', render: window.FireUiTabs.renderTabBonds },
    { id: 'inflation', label: 'インフレモデル', render: window.FireUiTabs.renderTabInflation },
    { id: 'run', label: '▶ 実行・結果', render: window.FireUiSimulation.renderTabRun }
  ];

  let appData = null;
  let currentTabId = TABS[0].id;

  /** appDataを保存し、現在表示中のタブを再描画する（設定変更のたびに呼ばれる） */
  function onAppDataChange() {
    FireState.saveAppData(appData);
    renderCurrentTab();
  }

  /** 現在選択中のタブの内容を描画する */
  function renderCurrentTab() {
    const tab = TABS.find((t) => t.id === currentTabId);
    const content = document.getElementById('tab-content');
    tab.render(content, appData, onAppDataChange);
  }

  /** タブバー（上部のタブボタン群）を描画する */
  function renderTabBar() {
    const tabBar = document.getElementById('tab-bar');
    tabBar.innerHTML = '';
    TABS.forEach((tab) => {
      const btn = createElement('button', {
        class: 'tab-btn' + (tab.id === currentTabId ? ' active' : ''),
        text: tab.label,
        onclick: () => {
          currentTabId = tab.id;
          renderTabBar();
          renderCurrentTab();
        }
      });
      tabBar.appendChild(btn);
    });
  }

  /** 設定の保存(JSONダウンロード)・読込ボタンを配線する */
  function wireHeaderButtons() {
    document.getElementById('btn-export-json').addEventListener('click', () => {
      FireState.exportAppDataAsFile(appData);
      showToast('設定をダウンロードしました');
    });

    document.getElementById('input-import-json').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      FireState.importAppDataFromFile(file, (loadedAppData) => {
        appData = loadedAppData;
        FireState.saveAppData(appData);
        renderTabBar();
        renderCurrentTab();
        showToast('設定を読み込みました');
      }, (errorMessage) => {
        showToast(errorMessage, 4000);
      });
      e.target.value = '';
    });
  }

  /** アプリ初期化 */
  function init() {
    appData = FireState.loadAppData();
    renderTabBar();
    renderCurrentTab();
    wireHeaderButtons();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
