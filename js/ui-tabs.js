/**
 * ===============================================================
 * 設定タブ描画関数群
 * ===============================================================
 * 各タブ（基本設定・保有銘柄・生活費…）の画面をDOMに描画する。
 * 1関数＝1画面の描画を担当する（可読性のため機能ごとに分割している）。
 * ===============================================================
 */
(function (global) {
  'use strict';
  const { createElement, showToast } = global.FireUiHelpers;
  const { renderEditableTable } = global.FireUiTables;

  // 口座種別セレクトの「自由入力」を表す特別な値（実際の口座種別文字列と衝突しないようにする）
  const FREE_ACCOUNT_TYPE_VALUE = '__FREE_INPUT__';

  const ACCOUNT_TYPE_OPTIONS = [
    { value: '特定', label: '特定口座' },
    { value: '一般', label: '一般口座' },
    { value: '旧NISA', label: '旧NISA' },
    { value: '積立(新NISA)', label: '積立(新NISA)' },
    { value: '成長(新NISA)', label: '成長(新NISA)' },
    { value: 'iDeCo', label: 'iDeCo' },
    { value: FREE_ACCOUNT_TYPE_VALUE, label: '自由入力' }
  ];

  /**
   * 全角数字・全角カンマを半角に変換したうえで、半角数字・カンマ・空白以外の文字を
   * 取り除く。「数字のみを許容したい自由入力欄」（配当支払月など、type=numberや
   * type=month/dateのような専用の入力形式が使えない項目）向けのサニタイズ処理。
   */
  function sanitizeToHalfWidthDigitsAndCommas(text) {
    const halfWidthText = text
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[，、]/g, ',');
    return halfWidthText.replace(/[^0-9, ]/g, '');
  }

  // =====================================================
  // 共通: 数値入力フィールドを1つ生成する
  // =====================================================
  function createNumberField(labelText, value, step, onChange) {
    const input = createElement('input', { type: 'number', step: step || 'any' });
    // 数値専用キーボード（スマホでの入力ミス防止）。全角文字はtype=numberの仕様上そもそも入力できない
    input.inputMode = (step !== undefined && String(step).indexOf('.') !== -1) ? 'decimal' : 'numeric';
    input.value = value;
    input.addEventListener('change', (e) => onChange(parseFloat(e.target.value) || 0));
    return createElement('div', { class: 'field' }, [
      createElement('label', { text: labelText }), input
    ]);
  }

  /** テキスト入力フィールドを1つ生成する */
  function createTextField(labelText, value, onChange) {
    const input = createElement('input', { type: 'text' });
    input.value = value || '';
    input.addEventListener('change', (e) => onChange(e.target.value));
    return createElement('div', { class: 'field' }, [
      createElement('label', { text: labelText }), input
    ]);
  }

  /**
   * 日付入力フィールド（type=date）を1つ生成する。ブラウザ標準の日付ピッカーを使うため、
   * 全角文字の入力やフォーマット崩れがそもそも起こらない（生年月日など、厳密な
   * yyyy-MM-dd形式が必要な項目に使う）。西暦は4桁の範囲に限定している。
   */
  function createDateField(labelText, value, onChange) {
    const input = createElement('input', { type: 'date', min: '1900-01-01', max: '2199-12-31' });
    input.value = value || '';
    input.addEventListener('change', (e) => onChange(e.target.value));
    return createElement('div', { class: 'field' }, [
      createElement('label', { text: labelText }), input
    ]);
  }

  /** 年月入力フィールド（type=month）を1つ生成する */
  function createMonthField(labelText, value, onChange) {
    const input = createElement('input', { type: 'month', min: '1900-01', max: '2199-12' });
    input.value = value || '';
    input.addEventListener('change', (e) => onChange(e.target.value));
    return createElement('div', { class: 'field' }, [
      createElement('label', { text: labelText }), input
    ]);
  }

  /** チェックボックスフィールドを1つ生成する */
  function createCheckboxField(labelText, checked, onChange) {
    const input = createElement('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', (e) => onChange(e.target.checked));
    return createElement('div', { class: 'field checkbox' }, [input, createElement('label', { text: labelText })]);
  }

  /** セレクトフィールドを1つ生成する */
  function createSelectField(labelText, value, options, onChange) {
    const select = createElement('select', {}, options.map((opt) => {
      const el = createElement('option', { value: opt.value, text: opt.label });
      if (opt.value === value) el.selected = true;
      return el;
    }));
    select.addEventListener('change', (e) => onChange(e.target.value));
    return createElement('div', { class: 'field' }, [
      createElement('label', { text: labelText }), select
    ]);
  }

  // =====================================================
  // 1. 基本設定
  // =====================================================
  function renderTabBasic(container, appData, onChange) {
    container.innerHTML = '';
    const c = appData.config;
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '基本設定' }),
      createElement('p', { class: 'desc', text: 'シミュレーションの期間・試行回数・初期現金など、全体に関わる設定を行います。' }),
      createElement('div', { class: 'form-grid' }, [
        createNumberField('シミュレーション期間（年）', c.period, 1, (v) => { c.period = Math.round(v); onChange(); }),
        createNumberField('試行回数（モンテカルロ試行数）', c.times, 1, (v) => { c.times = Math.round(v); onChange(); }),
        createDateField('生年月日', c.birthDate, (v) => { c.birthDate = v; onChange(); }),
        createNumberField('初期現金（円）', c.cash, 1000, (v) => { c.cash = Math.round(v); onChange(); }),
        createNumberField('失敗試行の詳細保存上限（0〜200）', c.failureDetailLimit, 1,
          (v) => { c.failureDetailLimit = Math.min(Math.max(Math.round(v), 0), 200); onChange(); })
      ])
    ]);
    container.appendChild(panel);
  }

  // =====================================================
  // 2. 保有銘柄
  // =====================================================

  const STOCK_EXCHANGE_RATE_OPTIONS = [
    { value: '', label: '（円建て）' }, { value: 'USD/JPY', label: 'USD/JPY' },
    { value: 'EUR/JPY', label: 'EUR/JPY' }, { value: 'EUR/USD', label: 'EUR/USD' }
  ];

  // 同期・ロックの対象となる項目（同一ベース銘柄なら必ず同じ値になるべき項目）。
  // 口数・平均取得価額・旧NISA課税開始年月は、口座ごとに異なりうるため対象外とする。
  const STOCK_SYNCED_FIELDS = ['tani', 'currentValuePerUnit', 'annualReturn', 'volatility', 'exchangeRate'];

  /** 銘柄名文字列からベース名（＜口座種別＞より前の部分）を取り出す */
  function extractStockBaseName(meigara) {
    return FireEngine._internal.getBaseName(meigara || '');
  }

  /** 銘柄名文字列から口座種別（＜…＞の中身）を取り出す。なければ空文字を返す */
  function extractStockAccountType(meigara) {
    const match = /＜([^＞]*)＞\s*$/.exec(meigara || '');
    return match ? match[1] : '';
  }

  /** ベース名と口座種別から、銘柄名文字列を組み立てる */
  function composeStockMeigara(baseName, accountType) {
    const trimmedBase = (baseName || '').trim();
    const trimmedAccount = (accountType || '').trim();
    return trimmedAccount ? trimmedBase + '＜' + trimmedAccount + '＞' : trimmedBase;
  }

  /**
   * 同一ベース銘柄名を持つ行同士で、単位・基準価額・期待リターン・ボラティリティ・
   * 為替ペアの値を、それぞれのグループの「最初に登場する行（ソース行）」の値に揃える。
   * ベース名の並び替え・削除・リネームが起きた直後に必ず呼び出すことで、
   * ロック状態の表示と実際のデータを常に一致させる。
   */
  function reconcileSyncedStockFields(stocks) {
    const sourceByBaseName = {};
    stocks.forEach((stock) => {
      const baseName = extractStockBaseName(stock.meigara);
      if (!baseName) return;
      if (!(baseName in sourceByBaseName)) sourceByBaseName[baseName] = stock;
    });
    stocks.forEach((stock) => {
      const baseName = extractStockBaseName(stock.meigara);
      if (!baseName) return;
      const source = sourceByBaseName[baseName];
      if (source === stock) return;
      STOCK_SYNCED_FIELDS.forEach((key) => { stock[key] = source[key]; });
    });
  }

  /**
   * ベース銘柄名を編集したときの処理。編集前のこの行が、他の行から「ソース」として
   * 参照されていた場合（＝同じベース名を持つ行の中で最初に登場する行だった場合）は、
   * それらの行のベース名も、新しい名前へ一緒に書き換える（従属関係を維持するため）。
   * 一方、ソースでない行（他の行に追従していた行）の名前だけを変えた場合は、
   * その行だけが独立し、他の行には影響しない。
   */
  function renameStockBaseNameWithCascade(stocks, editedIndex, newBaseName) {
    const oldBaseName = extractStockBaseName(stocks[editedIndex].meigara);
    const wasSource = oldBaseName !== '' &&
      stocks.findIndex((s) => extractStockBaseName(s.meigara) === oldBaseName) === editedIndex;

    if (wasSource) {
      stocks.forEach((stock, i) => {
        if (i !== editedIndex && extractStockBaseName(stock.meigara) === oldBaseName) {
          stock.meigara = composeStockMeigara(newBaseName, extractStockAccountType(stock.meigara));
        }
      });
    }
    stocks[editedIndex].meigara = composeStockMeigara(newBaseName, extractStockAccountType(stocks[editedIndex].meigara));
    reconcileSyncedStockFields(stocks);
  }

  /**
   * 指定した行より前（0〜index-1行目）に登場した、重複のないベース銘柄名の一覧を返す。
   * 「1行目に入れた銘柄は2行目以降の候補に、2行目に入れた銘柄は3行目以降の候補に…」
   * という、行の並び順に沿ったドロップダウン候補を作るために使う。
   */
  function collectPriorStockBaseNames(stocks, beforeIndex) {
    const names = [];
    for (let i = 0; i < beforeIndex; i++) {
      const baseName = extractStockBaseName(stocks[i].meigara);
      if (baseName && names.indexOf(baseName) === -1) names.push(baseName);
    }
    return names;
  }

  /** ロック対象項目1つ分のセル（ロック中は編集不可・ソース行の値を表示）を組み立てる */
  function buildStockSyncedField(stock, key, type, step, locked, onFieldChange) {
    if (key === 'exchangeRate') {
      const select = createElement('select', {}, STOCK_EXCHANGE_RATE_OPTIONS.map((opt) => {
        const optionEl = createElement('option', { value: opt.value, text: opt.label });
        if (opt.value === stock.exchangeRate) optionEl.selected = true;
        return optionEl;
      }));
      select.disabled = locked;
      select.addEventListener('change', (e) => onFieldChange(key, e.target.value));
      return select;
    }
    const input = createElement('input', { type: 'number' });
    if (step) input.step = step;
    input.inputMode = step ? 'decimal' : 'numeric';
    input.value = stock[key];
    input.disabled = locked;
    input.addEventListener('change', (e) => onFieldChange(key, parseFloat(e.target.value) || 0));
    return input;
  }

  /** 保有銘柄タブの1行分のDOM（<tr>）を組み立てる */
  function buildStockRow(stocks, index, onChange) {
    const stock = stocks[index];
    const baseName = extractStockBaseName(stock.meigara);
    const accountType = extractStockAccountType(stock.meigara);
    const isKnownAccountType = ACCOUNT_TYPE_OPTIONS.some((opt) => opt.value === accountType);

    const sourceIndex = baseName ? stocks.findIndex((s) => extractStockBaseName(s.meigara) === baseName) : -1;
    const locked = baseName !== '' && sourceIndex !== index;

    const onFieldChange = (key, value) => {
      stock[key] = value;
      reconcileSyncedStockFields(stocks);
      onChange();
    };

    // ベース銘柄名: 編集可能なドロップダウン（datalist）。
    // 候補は「この行より前に登場した、重複のないベース名」のみとする。
    const datalistId = 'stock-basename-options-' + index;
    const priorNames = collectPriorStockBaseNames(stocks, index);
    const datalist = createElement('datalist', { id: datalistId },
      priorNames.map((name) => createElement('option', { value: name })));
    const baseNameInput = createElement('input', { type: 'text', list: datalistId, placeholder: '銘柄名（ベース名）' });
    baseNameInput.value = baseName;
    baseNameInput.addEventListener('change', (e) => {
      renameStockBaseNameWithCascade(stocks, index, e.target.value.trim());
      onChange();
    });

    // 口座種別: あらかじめ用意した選択肢からのドロップダウン（「自由入力」選択時のみテキスト欄が出る）
    const accountSelect = createElement('select', {}, ACCOUNT_TYPE_OPTIONS.map((opt) => {
      const optionEl = createElement('option', { value: opt.value, text: opt.label });
      const shouldSelect = opt.value === FREE_ACCOUNT_TYPE_VALUE ? !isKnownAccountType : opt.value === accountType;
      if (shouldSelect) optionEl.selected = true;
      return optionEl;
    }));
    const customAccountInput = createElement('input', { type: 'text', placeholder: '口座種別を入力' });
    customAccountInput.value = isKnownAccountType ? '' : accountType;
    customAccountInput.style.display = isKnownAccountType ? 'none' : '';
    accountSelect.addEventListener('change', (e) => {
      const isFree = e.target.value === FREE_ACCOUNT_TYPE_VALUE;
      customAccountInput.style.display = isFree ? '' : 'none';
      stock.meigara = composeStockMeigara(baseName, isFree ? customAccountInput.value : e.target.value);
      reconcileSyncedStockFields(stocks);
      onChange();
    });
    customAccountInput.addEventListener('change', (e) => {
      stock.meigara = composeStockMeigara(baseName, e.target.value);
      reconcileSyncedStockFields(stocks);
      onChange();
    });

    const kuchisuInput = createElement('input', { type: 'number' });
    kuchisuInput.inputMode = 'numeric';
    kuchisuInput.style.minWidth = '13ch';
    kuchisuInput.value = stock.kuchisu;
    kuchisuInput.addEventListener('change', (e) => { stock.kuchisu = parseFloat(e.target.value) || 0; onChange(); });

    const avgPriceInput = createElement('input', { type: 'number' });
    avgPriceInput.inputMode = 'numeric';
    avgPriceInput.value = stock.averagePrice;
    avgPriceInput.addEventListener('change', (e) => { stock.averagePrice = parseFloat(e.target.value) || 0; onChange(); });

    const taxMonthInput = createElement('input', { type: 'month', min: '1900-01', max: '2199-12' });
    taxMonthInput.value = stock.taxStartYearMonth || '';
    taxMonthInput.addEventListener('change', (e) => { stock.taxStartYearMonth = e.target.value || null; onChange(); });

    const lockNote = locked ? createElement('span', { class: 'help-text', style: 'display:block; font-size:11px; margin-top:3px;', text: '🔒 先頭行と同期' }) : null;

    const deleteBtn = createElement('button', {
      class: 'btn btn-sm btn-danger', text: '×', title: 'この行を削除',
      onclick: () => {
        stocks.splice(index, 1);
        reconcileSyncedStockFields(stocks);
        onChange();
      }
    });

    return createElement('tr', {}, [
      createElement('td', {}, [baseNameInput, datalist]),
      createElement('td', {}, [accountSelect, customAccountInput]),
      createElement('td', {}, [kuchisuInput]),
      createElement('td', {}, [buildStockSyncedField(stock, 'tani', 'number', null, locked, onFieldChange), lockNote]),
      createElement('td', {}, [buildStockSyncedField(stock, 'currentValuePerUnit', 'number', null, locked, onFieldChange)]),
      createElement('td', {}, [avgPriceInput]),
      createElement('td', {}, [buildStockSyncedField(stock, 'annualReturn', 'number', '0.1', locked, onFieldChange)]),
      createElement('td', {}, [buildStockSyncedField(stock, 'volatility', 'number', '0.1', locked, onFieldChange)]),
      createElement('td', {}, [taxMonthInput]),
      createElement('td', {}, [buildStockSyncedField(stock, 'exchangeRate', null, null, locked, onFieldChange)]),
      createElement('td', { class: 'col-action' }, [deleteBtn])
    ]);
  }

  /** 保有銘柄タブのテーブル全体を描画する */
  function renderStocksTable(container, appData, onChange) {
    container.innerHTML = '';
    const stocks = appData.stocks;

    const table = createElement('table', { class: 'data-table' });
    const headers = ['銘柄名（ベース名）', '口座種別', '口数', '単位', '現在の基準価額', '平均取得価額',
      '期待年率リターン%', 'ボラティリティ%', '旧NISA課税開始年月', '為替ペア', ''];
    table.appendChild(createElement('thead', {}, [
      createElement('tr', {}, headers.map((h) => createElement('th', { text: h })))
    ]));

    const tbody = createElement('tbody');
    stocks.forEach((stock, index) => { tbody.appendChild(buildStockRow(stocks, index, onChange)); });
    table.appendChild(tbody);
    container.appendChild(createElement('div', { class: 'table-scroll' }, [table]));

    if (stocks.length === 0) {
      container.appendChild(createElement('p', { class: 'help-text', text: '（まだ登録がありません）' }));
    }

    const addBtn = createElement('button', {
      class: 'btn btn-sm', text: '＋ 銘柄を追加',
      onclick: () => {
        stocks.push({
          meigara: '＜特定＞', kuchisu: 0, tani: 10000, currentValuePerUnit: 10000, averagePrice: 10000,
          annualReturn: 5.0, volatility: 15.0, taxStartYearMonth: null, taxStartYear: 0, taxStartMonth: 0,
          exchangeRate: '', yahooFinanceCode: ''
        });
        reconcileSyncedStockFields(stocks);
        onChange();
      }
    });
    container.appendChild(addBtn);
  }

  function renderTabStocks(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '保有銘柄' }),
      createElement('p', {
        class: 'desc',
        text: '銘柄名（ベース名）は、この行より前に登録した銘柄をドロップダウンから選ぶか、新しい名前を入力してください。' +
          '同じベース名を選ぶと、単位・現在の基準価額・期待年率リターン・ボラティリティ・為替ペアは、' +
          '最初に登録した行（先頭行）の値に自動的にそろい、編集できなくなります（🔒同期）。' +
          '先頭行の名前を変更すると、それに従っていた行の名前も一緒に変わります。' +
          '口数・平均取得価額・旧NISA課税開始年月は、口座ごとに異なる場合が多いため、常に個別に編集できます。'
      })
    ]);

    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    renderStocksTable(tableContainer, appData, onChange);
  }

  // =====================================================
  // 3. 相関係数（soukan）
  // =====================================================

  /**
   * 保有銘柄一覧から、ベース銘柄名（＜口座種別＞を除いた部分）を重複排除して抽出する。
   * 同じ銘柄を複数の口座（特定・NISA・iDeCoなど）で保有していても、相関係数の設定は
   * 銘柄単位で1件だけ選べればよいため、選択肢はベース名単位にまとめる。
   */
  function collectUniqueBaseNames(stocks) {
    const getBaseName = FireEngine._internal.getBaseName;
    const uniqueNames = [];
    stocks.forEach((stock) => {
      const baseName = getBaseName(stock.meigara);
      if (uniqueNames.indexOf(baseName) === -1) uniqueNames.push(baseName);
    });
    return uniqueNames;
  }

  function renderTabSoukan(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '銘柄間の相関係数' }),
      createElement('p', {
        class: 'desc',
        text: '異なる銘柄同士の値動きの相関を-1.0〜1.0で設定します（未設定は無相関=0として扱われます）。' +
          'ここでの銘柄はベース銘柄名（＜口座種別＞を除いた部分）単位で選択します。' +
          '同じ銘柄を複数の口座（特定・旧NISA・新NISA・iDeCoなど）で保有していても、設定は' +
          '銘柄の組み合わせごとに1件だけで済み、すべての口座の組み合わせに自動的に同じ相関係数が' +
          '適用されます（口座違いによる入力ミス・食い違いを防ぐため）。なお、同一銘柄の異口座間は' +
          '常に相関1.0として自動的に扱われるため、ここで設定する必要はありません。' +
          '一覧は「銘柄A」が同じ行同士がまとまって並ぶよう、自動的に並び替えられます。'
      })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    // 「銘柄A」が同じ行同士が連続してまとまるよう、銘柄Aの値で並び替える
    // （例: AAA/BBBB, CCC/BBBB, AAA/CCC → AAA/BBBB, AAA/CCC, CCC/BBBB の順にする）
    appData.soukan.sort((a, b) => {
      if (a.aMeigara === b.aMeigara) return 0;
      return a.aMeigara < b.aMeigara ? -1 : 1;
    });

    const meigaraOptions = collectUniqueBaseNames(appData.stocks).map((name) => ({ value: name, label: name }));

    renderEditableTable(tableContainer, {
      columns: [
        { key: 'aMeigara', label: '銘柄A', type: 'select', options: meigaraOptions },
        { key: 'bMeigara', label: '銘柄B', type: 'select', options: meigaraOptions },
        { key: 'keisu', label: '相関係数（-1.0〜1.0）', type: 'number', step: '0.05' }
      ],
      rows: appData.soukan,
      createEmptyRow: () => ({ aMeigara: '', bMeigara: '', keisu: 0.0 }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 相関設定を追加'
    });
  }

  // =====================================================
  // 4. 生活費（lifeCostPeriods）
  // =====================================================
  function renderTabLifeCost(container, appData, onChange) {
    container.innerHTML = '';
    container.appendChild(createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '生活費' }),
      createElement('p', {
        class: 'desc',
        text: '適用開始年月ごとに生活費カテゴリを設定できます（例: 定年後に生活費が変わる場合など）。' +
          '「2000-01」は削除できない基底期間です。各カテゴリのインフレ率は年率で、毎年1月に複利適用されます。'
      })
    ]));

    appData.lifeCostPeriods.forEach((period, periodIndex) => {
      const periodPanel = createElement('div', { class: 'panel' });
      const isDefault = period.appliesFromYearMonth === '2000-01';

      const headerRow = createElement('div', { class: 'form-grid' }, [
        createMonthField('適用開始年月', period.appliesFromYearMonth === '2000-01' ? '' : period.appliesFromYearMonth,
          (v) => { period.appliesFromYearMonth = v || '2000-01'; onChange(); })
      ]);
      periodPanel.appendChild(createElement('h2', { text: isDefault ? '基底期間（2000-01〜）' : '期間 #' + (periodIndex + 1) }));
      if (!isDefault) periodPanel.appendChild(headerRow);

      const totalMonthly = period.categories.reduce((s, c) => s + c.monthlyAmount, 0);
      periodPanel.appendChild(createElement('p', { class: 'help-text', text: '月次生活費合計: ' + Math.round(totalMonthly).toLocaleString('ja-JP') + '円' }));

      const catTableContainer = createElement('div');
      periodPanel.appendChild(catTableContainer);
      renderEditableTable(catTableContainer, {
        columns: [
          { key: 'name', label: 'カテゴリ名', type: 'text' },
          { key: 'monthlyAmount', label: '月額（円）', type: 'number' },
          { key: 'inflationRate', label: 'インフレ率%（年率）', type: 'number', step: '0.1' }
        ],
        rows: period.categories,
        createEmptyRow: () => ({ name: '新規カテゴリ', monthlyAmount: 0, inflationRate: 2.0 }),
        onChange: () => onChange(),
        addButtonLabel: '＋ カテゴリを追加'
      });

      if (!isDefault) {
        const delBtn = createElement('button', {
          class: 'btn btn-sm btn-danger', text: 'この期間を削除',
          onclick: () => {
            appData.lifeCostPeriods.splice(periodIndex, 1);
            onChange();
            renderTabLifeCost(container, appData, onChange);
          }
        });
        periodPanel.appendChild(createElement('div', { class: 'row-actions' }, [delBtn]));
      }
      container.appendChild(periodPanel);
    });

    const addPeriodBtn = createElement('button', {
      class: 'btn btn-primary', text: '＋ 新しい生活費期間を追加',
      onclick: () => {
        appData.lifeCostPeriods.push({
          appliesFromYearMonth: '2030-01',
          categories: FireState.createDefaultInflationCategories(300000)
        });
        onChange();
        renderTabLifeCost(container, appData, onChange);
      }
    });
    container.appendChild(createElement('div', { class: 'row-actions' }, [addPeriodBtn]));
  }

  // =====================================================
  // 5. 収入イベント
  // =====================================================
  function renderTabIncome(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '収入イベント' }),
      createElement('p', { class: 'desc', text: '給与・副収入など、特定の期間に発生する月額収入を登録します。終了年月を空欄にすると永続収入になります。' })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    renderEditableTable(tableContainer, {
      columns: [
        { key: 'description', label: '説明', type: 'text' },
        { key: 'amount', label: '月額（円）', type: 'number' },
        { key: 'fromMonth', label: '開始年月', type: 'month' },
        { key: 'toMonth', label: '終了年月（空欄=永続）', type: 'month' }
      ],
      rows: appData.income,
      createEmptyRow: () => ({ amount: 0, fromMonth: '', toMonth: '', description: '新規収入', startTotalMonths: 0, endTotalMonths: null }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 収入を追加'
    });
  }

  // =====================================================
  // 6. 追加投資
  // =====================================================
  function renderTabTuika(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '追加投資' }),
      createElement('p', { class: 'desc', text: '積立投資など、指定した銘柄への定期的な追加投資を設定します。パターンは「各月」「各年」「１回」から選べます。' })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    const meigaraOptions = appData.stocks.map((s) => ({ value: s.meigara, label: s.meigara }));

    renderEditableTable(tableContainer, {
      columns: [
        { key: 'meigara', label: '投資先銘柄', type: 'select', options: meigaraOptions },
        { key: 'amount', label: '1回あたり金額（円）', type: 'number' },
        {
          key: 'pattern', label: 'パターン', type: 'select',
          options: [{ value: '各月', label: '各月' }, { value: '各年', label: '各年' }, { value: '１回', label: '１回' }]
        },
        { key: 'fromMonth', label: '開始年月', type: 'month' },
        { key: 'toMonth', label: '終了年月', type: 'month' }
      ],
      rows: appData.tuika,
      createEmptyRow: () => ({
        meigara: meigaraOptions.length > 0 ? meigaraOptions[0].value : '',
        amount: 0, month: 0, fromMonthNum: 1, fromMonth: '', toMonth: '', pattern: '各月', toMonthTotalMonths: 0
      }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 追加投資を追加'
    });
  }

  // =====================================================
  // 7. 大きな出費
  // =====================================================
  function renderTabBigExpense(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '大きな出費' }),
      createElement('p', { class: 'desc', text: '車の買い替え・住宅リフォームなど、特定の月に一時的に発生する大きな出費を登録します。' })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    renderEditableTable(tableContainer, {
      columns: [
        { key: 'description', label: '内容', type: 'text' },
        { key: 'amount', label: '金額（円）', type: 'number' },
        { key: 'fromMonth', label: '発生年月', type: 'month' }
      ],
      rows: appData.bigExpense,
      createEmptyRow: () => ({ amount: 0, fromMonth: '', description: '新規出費', month: 0 }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 出費を追加'
    });
  }

  // =====================================================
  // 8. 税率イベント
  // =====================================================
  function renderTabTax(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '税率イベント' }),
      createElement('p', { class: 'desc', text: '将来の税制変更を織り込みたい場合に設定します。未設定の場合はデフォルトの20.315%（所得税15.315%＋住民税5%）が適用されます。' })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    renderEditableTable(tableContainer, {
      columns: [
        { key: 'rate', label: '税率%（例:20.315）', type: 'number', step: '0.001' },
        { key: 'fromMonth', label: '適用開始年月', type: 'month' }
      ],
      rows: appData.tax,
      createEmptyRow: () => ({ rate: 20.315, fromMonth: '', month: 0 }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 税率変更を追加'
    });
  }

  // =====================================================
  // 9. 為替レート・為替相関
  // =====================================================
  function renderTabFx(container, appData, onChange) {
    container.innerHTML = '';
    const panel1 = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '為替レート設定' }),
      createElement('p', {
        class: 'desc',
        text: 'USD/JPY・EUR/JPY・EUR/USDの3ペアはOrnstein-Uhlenbeck過程（平均回帰モデル）で変動します。未設定ペアはデフォルト値' +
          '（USD/JPY: 現在150.0→目標145.0、EUR/JPY: 現在160.0→目標155.0、EUR/USD: 現在1.08→目標1.05）が使われます。'
      })
    ]);
    const table1 = createElement('div');
    panel1.appendChild(table1);
    container.appendChild(panel1);

    renderEditableTable(table1, {
      columns: [
        {
          key: 'pair', label: '通貨ペア', type: 'select',
          options: [{ value: 'USD/JPY', label: 'USD/JPY' }, { value: 'EUR/JPY', label: 'EUR/JPY' }, { value: 'EUR/USD', label: 'EUR/USD' }]
        },
        { key: 'currentRate', label: '現在レート', type: 'number', step: '0.01' },
        { key: 'targetRate', label: '目標（長期平均）レート', type: 'number', step: '0.01' },
        { key: 'volatility', label: 'ボラティリティ%', type: 'number', step: '0.1' },
        { key: 'reversionSpeed', label: '回帰速度', type: 'number', step: '0.01' }
      ],
      rows: appData.exchangeRate,
      createEmptyRow: () => ({ pair: 'USD/JPY', currentRate: 150.0, targetRate: 145.0, volatility: 10.0, reversionSpeed: 0.05 }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 為替ペア設定を追加'
    });

    const panel2 = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '為替ペア間の相関' }),
      createElement('p', { class: 'desc', text: '通貨ペア同士の相関係数を設定します（未設定は無相関）。' })
    ]);
    const table2 = createElement('div');
    panel2.appendChild(table2);
    container.appendChild(panel2);

    const pairOptions = [{ value: 'USD/JPY', label: 'USD/JPY' }, { value: 'EUR/JPY', label: 'EUR/JPY' }, { value: 'EUR/USD', label: 'EUR/USD' }];
    renderEditableTable(table2, {
      columns: [
        { key: 'pairA', label: 'ペアA', type: 'select', options: pairOptions },
        { key: 'pairB', label: 'ペアB', type: 'select', options: pairOptions },
        { key: 'keisu', label: '相関係数', type: 'number', step: '0.05' }
      ],
      rows: appData.exchangeRateCorrelations,
      createEmptyRow: () => ({ pairA: 'USD/JPY', pairB: 'EUR/JPY', keisu: 0.0 }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 為替相関を追加'
    });
  }

  // =====================================================
  // 10. 配当設定
  // =====================================================
  function renderTabDividend(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '配当設定' }),
      createElement('p', { class: 'desc', text: '配当を出す銘柄について、配当率・支払月を設定します。支払月は複数選択できます（カンマ区切りで1〜12を入力、例:"3,9"）。' })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    const meigaraOptions = appData.stocks.map((s) => ({ value: s.meigara, label: s.meigara }));

    // paymentMonths（配列）はカンマ区切り文字列として編集するための特殊カラムを使う
    renderEditableTableWithMonthsColumn(tableContainer, appData.dividendSetting, meigaraOptions, onChange);
  }

  /** 配当設定テーブル: paymentMonths（数値配列）をカンマ区切りテキストとして編集する特殊対応 */
  function renderEditableTableWithMonthsColumn(container, rows, meigaraOptions, onChange) {
    container.innerHTML = '';
    const table = createElement('table', { class: 'data-table' });
    table.appendChild(createElement('thead', {}, [
      createElement('tr', {}, [
        createElement('th', { text: '対象銘柄' }), createElement('th', { text: '配当率%（年率）' }),
        createElement('th', { text: '支払月（カンマ区切り 例:3,9）' }), createElement('th', { text: '税調整' }),
        createElement('th', { class: 'col-action' })
      ])
    ]));
    const tbody = createElement('tbody');
    rows.forEach((row, idx) => {
      const meigaraSelect = createElement('select', {}, meigaraOptions.map((opt) => {
        const el = createElement('option', { value: opt.value, text: opt.label });
        if (opt.value === row.meigaraKey) el.selected = true;
        return el;
      }));
      meigaraSelect.addEventListener('change', (e) => { row.meigaraKey = e.target.value; onChange(); });

      const rateInput = createElement('input', { type: 'number', step: '0.01' });
      rateInput.value = row.dividendRate;
      rateInput.addEventListener('change', (e) => { row.dividendRate = parseFloat(e.target.value) || 0; onChange(); });

      const monthsInput = createElement('input', { type: 'text', inputmode: 'numeric', placeholder: '例: 3,9' });
      monthsInput.value = (row.paymentMonths || []).join(',');
      // 全角数字・全角カンマで入力してしまっても、その場で半角に変換・不要文字を除去する
      monthsInput.addEventListener('input', (e) => {
        const sanitized = sanitizeToHalfWidthDigitsAndCommas(e.target.value);
        if (sanitized !== e.target.value) e.target.value = sanitized;
      });
      monthsInput.addEventListener('change', (e) => {
        row.paymentMonths = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 1 && n <= 12);
        onChange();
      });

      const adjustSelect = createElement('select', {}, ['調整なし', '調整あり'].map((v) => {
        const el = createElement('option', { value: v, text: v });
        if (v === row.taxAdjustment) el.selected = true;
        return el;
      }));
      adjustSelect.addEventListener('change', (e) => { row.taxAdjustment = e.target.value; onChange(); });

      const delBtn = createElement('button', {
        class: 'btn btn-sm btn-danger', text: '×',
        onclick: () => { rows.splice(idx, 1); onChange(); renderEditableTableWithMonthsColumn(container, rows, meigaraOptions, onChange); }
      });

      tbody.appendChild(createElement('tr', {}, [
        createElement('td', {}, [meigaraSelect]), createElement('td', {}, [rateInput]),
        createElement('td', {}, [monthsInput]), createElement('td', {}, [adjustSelect]),
        createElement('td', { class: 'col-action' }, [delBtn])
      ]));
    });
    table.appendChild(tbody);
    container.appendChild(table);
    if (rows.length === 0) container.appendChild(createElement('p', { class: 'help-text', text: '（まだ登録がありません）' }));

    const addBtn = createElement('button', {
      class: 'btn btn-sm', text: '＋ 配当設定を追加',
      onclick: () => {
        rows.push({ meigaraKey: meigaraOptions.length > 0 ? meigaraOptions[0].value : '', dividendRate: 0, paymentMonths: [], taxAdjustment: '調整なし' });
        onChange();
        renderEditableTableWithMonthsColumn(container, rows, meigaraOptions, onChange);
      }
    });
    container.appendChild(createElement('div', { class: 'row-actions' }, [addBtn]));
  }

  // =====================================================
  // 11. 現金／国債バッファ戦略
  // =====================================================
  function renderTabCashBuffer(container, appData, onChange) {
    container.innerHTML = '';
    const cb = appData.cashBufferConfig;
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '現金／国債バッファ戦略' }),
      createElement('p', {
        class: 'desc',
        text: '暴落時（直近高値からの下落率が閾値を超えたとき）に投資資産を売らず、現金または変動10年国債のバッファから生活費を賄う戦略です。' +
          '暴落判定はドローダウン（直近高値からの下落率）に基づくステートマシン（NORMAL⇄CRISIS、REFILLは派生状態）で管理されます。'
      }),
      createElement('div', { class: 'form-grid' }, [
        createCheckboxField('有効にする', cb.enabled, (v) => { cb.enabled = v; onChange(); renderTabCashBuffer(container, appData, onChange); })
      ])
    ]);
    container.appendChild(panel);
    if (!cb.enabled) return;

    const panel2 = createElement('div', { class: 'panel' }, [
      createElement('div', { class: 'form-grid' }, [
        createNumberField('バッファ年数（生活費の何年分）', cb.cashBufferYears, 0.1, (v) => { cb.cashBufferYears = v; onChange(); }),
        createNumberField('暴落判定閾値%（直近高値からの下落率）', cb.crashThresholdPct, 1, (v) => { cb.crashThresholdPct = v; onChange(); }),
        createNumberField('回復判定閾値%（ここまで戻れば通常モードへ）', cb.recoveryThresholdPct, 1, (v) => { cb.recoveryThresholdPct = v; onChange(); }),
        createCheckboxField('国債バッファを使う（現金の代わりに変動10年国債）', cb.useJgbBuffer, (v) => { cb.useJgbBuffer = v; onChange(); renderTabCashBuffer(container, appData, onChange); })
      ])
    ]);
    container.appendChild(panel2);

    if (cb.useJgbBuffer) {
      const panel3 = createElement('div', { class: 'panel' }, [
        createElement('h2', { text: '国債バッファ詳細設定' }),
        createElement('div', { class: 'form-grid' }, [
          createNumberField('国債利率%（登録時点の適用利率で固定）', cb.jgbCouponRate, 0.01, (v) => { cb.jgbCouponRate = v; onChange(); }),
          createMonthField('購入開始年月（空欄=即開始）', cb.jgbStartYearMonth, (v) => { cb.jgbStartYearMonth = v; onChange(); })
        ])
      ]);
      container.appendChild(panel3);
    }
  }

  // =====================================================
  // 12. iDeCo設定
  // =====================================================
  function renderTabIdeco(container, appData, onChange) {
    container.innerHTML = '';
    const idc = appData.idecoConfig;
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: 'iDeCo（個人型確定拠出年金）設定' }),
      createElement('p', {
        class: 'desc',
        text: 'iDeCoの積立自体は保有銘柄で銘柄名に「＜iDeCo＞」を付けて登録してください（追加投資で積立額を設定します）。' +
          'ここでは受給可能年齢の判定・退職所得課税の計算に必要な情報のみ設定します。受け取り方法は一時金（一括受取）のみに対応しています。'
      }),
      createElement('div', { class: 'form-grid' }, [
        createCheckboxField('有効にする', idc.enabled, (v) => { idc.enabled = v; onChange(); renderTabIdeco(container, appData, onChange); })
      ])
    ]);
    container.appendChild(panel);
    if (!idc.enabled) return;

    const panel2 = createElement('div', { class: 'panel' }, [
      createElement('div', { class: 'form-grid' }, [
        createMonthField('iDeCo拠出開始年月', idc.startYearMonth, (v) => { idc.startYearMonth = v; onChange(); }),
        createNumberField('拠出可能年齢上限（歳）', idc.contributionAgeLimit, 1, (v) => { idc.contributionAgeLimit = Math.round(v); onChange(); }),
        createNumberField('会社員としての勤続年数', idc.companyServiceYears, 1, (v) => { idc.companyServiceYears = Math.round(v); onChange(); }),
        createNumberField('退職金の額（円）', idc.severanceAmount, 10000, (v) => { idc.severanceAmount = Math.round(v); onChange(); }),
        createMonthField('退職金受取年月（会社を辞める年月）', idc.severanceYearMonth, (v) => { idc.severanceYearMonth = v; onChange(); }),
        createMonthField('iDeCo一時金の受給予定年月', idc.receiveYearMonth, (v) => { idc.receiveYearMonth = v; onChange(); })
      ])
    ]);
    container.appendChild(panel2);

    if (idc.startYearMonth && appData.config.birthDate) {
      const eligible = FireRetirementTax.calculateEligibleReceiveYearMonth(appData.config.birthDate, idc.startYearMonth);
      if (eligible) {
        container.appendChild(createElement('p', { class: 'help-text', text: '参考: 受給可能になる最も早い年月は ' + eligible + ' です（60歳時点の通算加入者等期間による10年ルールに基づく概算）。' }));
      }
    }
  }

  // =====================================================
  // 13. 債券
  // =====================================================
  function renderTabBonds(container, appData, onChange) {
    container.innerHTML = '';
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '保有債券' }),
      createElement('p', { class: 'desc', text: '利息収入は利息振込月に、満期返金は満期年月にそれぞれ現金へ反映されます。税率は「税率イベント」で設定した税率が使われます。' })
    ]);
    const tableContainer = createElement('div');
    panel.appendChild(tableContainer);
    container.appendChild(panel);

    renderEditableTable(tableContainer, {
      columns: [
        { key: 'name', label: '銘柄名', type: 'text' },
        { key: 'faceValue', label: '額面（1枚あたり）', type: 'number' },
        { key: 'initialUnitPrice', label: '購入単価', type: 'number' },
        { key: 'quantity', label: '保有数', type: 'number' },
        { key: 'couponRate', label: '利率%（年率）', type: 'number', step: '0.01' },
        { key: 'maturityYM', label: '満期年月', type: 'month' },
        { key: 'currency', label: '通貨', type: 'select', options: [{ value: 'JPY', label: '円（JPY）' }, { value: 'USD', label: 'ドル（USD）' }, { value: 'EUR', label: 'ユーロ（EUR）' }] },
        { key: 'purchaseFxRate', label: '購入時FXレート（円建ては1）', type: 'number', step: '0.01' }
      ],
      rows: appData.bonds,
      createEmptyRow: () => ({
        id: 'bond_' + Date.now() + '_' + Math.floor(Math.random() * 10000), name: '新規債券',
        faceValue: 100000, initialUnitPrice: 100000, quantity: 1, couponRate: 2.0,
        paymentMonths: [3, 9], maturityYM: '', currency: 'JPY', purchaseFxRate: 1.0, purchases: []
      }),
      onChange: () => onChange(),
      addButtonLabel: '＋ 債券を追加'
    });
    container.appendChild(createElement('p', { class: 'help-text', text: '利息振込月はデフォルトで3月・9月（半年ごと）です。変更する場合は下の設定JSONを直接編集してください。' }));
  }

  // =====================================================
  // 14. 確率的インフレ変動モデル
  // =====================================================
  function renderTabInflation(container, appData, onChange) {
    container.innerHTML = '';
    const inf = appData.inflationModelConfig;
    const panel = createElement('div', { class: 'panel' }, [
      createElement('h2', { text: '確率的インフレ変動モデル（マクロ経済レジーム）' }),
      createElement('p', {
        class: 'desc',
        text: 'ONにすると、毎年「通常」「過熱（マイルドインフレ・株高）」「引き締め（高インフレ・株安）」' +
          '「スタグフレーション（高インフレ・株安が持続）」「ゴルディロックス（低インフレ・株高が持続）」の' +
          '5つの経済レジームのいずれかに確率的に移行し、その年のインフレ率・株式リターン・ボラティリティに' +
          '影響します。マイルドなインフレは株高要因、行き過ぎたインフレは株安要因になる、という非線形な関係と、' +
          'ショックが数年尾を引くラグ効果、複数年続く例外的な相場（スタグフレーション等）を1つのモデルで' +
          '表現します。デフォルトはOFF（決定論的な基礎インフレ率のみ）です。'
      }),
      createElement('div', { class: 'form-grid' }, [
        createCheckboxField('有効にする', inf.enabled, (v) => { inf.enabled = v; onChange(); renderTabInflation(container, appData, onChange); })
      ])
    ]);
    container.appendChild(panel);
    if (!inf.enabled) return;

    const panel2 = createElement('div', { class: 'panel' }, [
      createElement('div', { class: 'form-grid' }, [
        createSelectField('レジームによる影響度', inf.regimeIntensity,
          [{ value: 'weak', label: '弱い' }, { value: 'normal', label: '普通' }, { value: 'strong', label: '強い' }],
          (v) => { inf.regimeIntensity = v; onChange(); })
      ]),
      createElement('p', {
        class: 'help-text',
        text: '各レジームがインフレ率・株式リターン・ボラティリティに与える影響の大きさを調整します' +
          '（レジーム間の遷移確率そのものは変わりません）。'
      })
    ]);
    container.appendChild(panel2);
  }

  global.FireUiTabs = {
    renderTabBasic, renderTabStocks, renderTabSoukan, renderTabLifeCost, renderTabIncome,
    renderTabTuika, renderTabBigExpense, renderTabTax, renderTabFx, renderTabDividend,
    renderTabCashBuffer, renderTabIdeco, renderTabBonds, renderTabInflation
  };
})(typeof window !== 'undefined' ? window : globalThis);
