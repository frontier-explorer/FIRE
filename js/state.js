/**
 * ===============================================================
 * アプリケーション状態管理
 * ===============================================================
 * appData（シミュレーション設定全体）のデフォルト値生成、
 * ブラウザの localStorage への自動保存・復元、JSONファイルとしての
 * インポート/エクスポートを担当する。
 *
 * 【永続化方針】
 * Androidアプリはファイルシステムに保存するが、Web版はブラウザの
 * localStorage に自動保存する（キー: "fireSimulatorAppData"）。
 * また、他の端末への移行やバックアップのため、JSONファイルとしての
 * 書き出し・読み込みにも対応する。
 * ===============================================================
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'fireSimulatorAppData';

  /**
   * 月次生活費合計から、デフォルトの分野別インフレカテゴリを生成する。
   * Kotlin版 InflationCategory.createDefaults() に対応する。
   */
  function createDefaultInflationCategories(totalMonthly) {
    const defs = [
      ['食費・日用品', 0.35, 3.5],
      ['住居費', 0.25, 0.5],
      ['光熱・通信費', 0.10, 2.0],
      ['医療・保険', 0.10, 3.0],
      ['交通・車', 0.10, 1.5],
      ['娯楽・教育', 0.10, 2.0]
    ];
    return defs.map(([name, ratio, rate]) => ({
      name, monthlyAmount: Math.round(totalMonthly * ratio), inflationRate: rate
    }));
  }

  /**
   * アプリ初回起動時のデフォルト（サンプル）AppDataを生成する。
   *
   * 【サンプルシナリオ】
   *   誕生日: 2000-01-01（シミュレーション実行時点でおおよそ26歳）
   *   50歳（2050年）でリタイア。それまでは給与収入があり、積立投資を継続する。
   *   100歳（2100年）まで、退職後の資産取り崩しをシミュレーションする
   *   （config.period=74年は、現在日付からおおよそ100歳到達までの年数）。
   *
   *   保有銘柄はSlimSP500・slimオルカンの2銘柄のみとし、
   *   特定・旧NISA・新NISA（成長／積立）・iDeCoの4つの口座種別を
   *   きちんと使い分けている状態を再現する:
   *     SlimSP500＜特定＞         3,000万円 → 売却優先度①（即課税）
   *     SlimSP500＜旧NISA＞      500万円 → 旧NISA（課税開始2028-12。新規購入は終了済みの想定）
   *     SlimSP500＜iDeCo＞       120万円 → iDeCo（60歳＝2060-01まで凍結、一時金として受給）
   *     slimオルカン＜成長(新NISA)＞ 1,800万円 → 新NISA成長投資枠（恒久非課税）
   *     slimオルカン＜積立(新NISA)＞  900万円 → 新NISA つみたて投資枠（恒久非課税）
   *
   *   現役期間（〜2050-01）は給与収入65万円/月から、生活費20万円/月を賄いつつ、
   *   特定・新NISA（成長／積立）・iDeCoへ毎月積立投資を継続する。50歳でリタイア後は
   *   収入・積立投資とも終了し、退職金800万円を受け取り、生活費28万円/月を資産から
   *   取り崩して100歳まで生活する。
   */
  function createDefaultAppData() {
    return {
      config: { period: 74, times: 200, birthDate: '2000-01-01', cash: 1000000, failureDetailLimit: 50 },
      stocks: [
        // 【特定口座】SlimSP500 — 売却優先度①（即課税）
        // 7,317,073口 × 41,000円 ÷ 10,000 ≒ 3,000万円
        {
          meigara: 'SlimSP500＜特定＞', kuchisu: 7317073, tani: 10000,
          currentValuePerUnit: 41000, averagePrice: 30000, annualReturn: 10.0, volatility: 18.0,
          taxStartYearMonth: null, taxStartYear: 0, taxStartMonth: 0, exchangeRate: '', yahooFinanceCode: ''
        },
        // 【旧NISA】SlimSP500 — 新規購入は終了済み。課税開始2028-12（5年間の非課税期間終了後）
        // 1,219,512口 × 41,000円 ÷ 10,000 ≒ 500万円
        {
          meigara: 'SlimSP500＜旧NISA＞', kuchisu: 1219512, tani: 10000,
          currentValuePerUnit: 41000, averagePrice: 33000, annualReturn: 10.0, volatility: 18.0,
          taxStartYearMonth: '2028-12', taxStartYear: null, taxStartMonth: null, exchangeRate: '', yahooFinanceCode: ''
        },
        // 【iDeCo】SlimSP500 — 60歳（2060-01）まで凍結、以降は一時金として受給（idecoConfig参照）
        // 292,683口 × 41,000円 ÷ 10,000 ≒ 120万円
        {
          meigara: 'SlimSP500＜iDeCo＞', kuchisu: 292683, tani: 10000,
          currentValuePerUnit: 41000, averagePrice: 34000, annualReturn: 10.0, volatility: 18.0,
          taxStartYearMonth: null, taxStartYear: 0, taxStartMonth: 0, exchangeRate: '', yahooFinanceCode: ''
        },
        // 【新NISA 成長投資枠】slimオルカン — 恒久非課税
        // 5,625,000口 × 32,000円 ÷ 10,000 ＝ 1,800万円
        {
          meigara: 'slimオルカン＜成長(新NISA)＞', kuchisu: 5625000, tani: 10000,
          currentValuePerUnit: 32000, averagePrice: 24000, annualReturn: 8.0, volatility: 15.0,
          taxStartYearMonth: null, taxStartYear: 0, taxStartMonth: 0, exchangeRate: '', yahooFinanceCode: ''
        },
        // 【新NISA つみたて投資枠】slimオルカン — 恒久非課税
        // 2,812,500口 × 32,000円 ÷ 10,000 ＝ 900万円
        {
          meigara: 'slimオルカン＜積立(新NISA)＞', kuchisu: 2812500, tani: 10000,
          currentValuePerUnit: 32000, averagePrice: 25000, annualReturn: 8.0, volatility: 15.0,
          taxStartYearMonth: null, taxStartYear: 0, taxStartMonth: 0, exchangeRate: '', yahooFinanceCode: ''
        }
      ],
      // SP500系（特定・旧NISA・iDeCo）とオルカン系（新NISA成長・積立）は
      // それぞれ内部で自動的に相関1.0となるため、ベース銘柄名同士（SP500 ⇔ オルカン）の
      // 相関を1件設定すれば、口座の組み合わせに関わらず全パターンに適用される
      soukan: [
        { aMeigara: 'SlimSP500', bMeigara: 'slimオルカン', keisu: 0.92 }
      ],
      tuika: [
        // 現役期間中（2050年1月のリタイアまで）、特定・新NISA（成長／積立）・iDeCoへ毎月積立投資を継続する
        { meigara: 'SlimSP500＜特定＞', amount: 100000, fromMonth: '2022-04', toMonth: '2050-01', pattern: '各月' },
        { meigara: 'slimオルカン＜成長(新NISA)＞', amount: 200000, fromMonth: '2024-01', toMonth: '2050-01', pattern: '各月' },
        { meigara: 'slimオルカン＜積立(新NISA)＞', amount: 100000, fromMonth: '2024-01', toMonth: '2050-01', pattern: '各月' },
        { meigara: 'SlimSP500＜iDeCo＞', amount: 20000, fromMonth: '2023-04', toMonth: '2050-01', pattern: '各月' }
      ],
      bigExpense: [],
      income: [
        // 給与収入（生活費・積立投資を賄う手取り収入）。50歳のリタイアと同時に終了する
        { amount: 650000, fromMonth: '2022-04', toMonth: '2050-01', description: '給与収入' }
      ],
      tax: [],
      exchangeRate: [],
      exchangeRateCorrelations: [],
      dividendSetting: [],
      lifeCostPeriods: [
        // 現役・積立投資期間: 月20万円
        { appliesFromYearMonth: '2000-01', categories: createDefaultInflationCategories(200000) },
        // リタイア後（50歳〜100歳）: 月28万円
        { appliesFromYearMonth: '2050-01', categories: createDefaultInflationCategories(280000) }
      ],
      cashBufferConfig: {
        enabled: false, cashBufferYears: 2.5, crashThresholdPct: 20.0, recoveryThresholdPct: 5.0,
        useJgbBuffer: false, jgbCouponRate: 0.5, jgbStartYearMonth: '', jgbLots: []
      },
      bonds: [],
      // regimeIntensity: マクロ経済レジーム（NORMAL/OVERHEAT/TIGHTENING/STAGFLATION/GOLDILOCKS）
      // による、インフレ率・株式リターンへの影響度（'weak'|'normal'|'strong'）。詳細はengine.js内
      // 「インフレ・市場リターンのマクロ経済レジーム（体制）モデル」のコメントを参照。
      inflationModelConfig: { enabled: false, regimeIntensity: 'normal' },
      // iDeCo設定: 2023-04拠出開始、65歳まで拠出可能（実際は50歳のリタイアで積立が止まる）、
      // 60歳（2060-01）から一時金として受給。退職金800万円は50歳のリタイアと同時に受給する
      idecoConfig: {
        enabled: true, startYearMonth: '2023-04', contributionAgeLimit: 65, companyServiceYears: 28,
        severanceAmount: 8000000, severanceYearMonth: '2050-01', receiveYearMonth: '2060-01'
      }
    };
  }

  // =====================================================
  // Android版JSONとの互換変換
  //
  // 【背景】
  // Android版アプリはKotlinの @SerializedName で定義したキー名でJSONを
  // 書き出す。ほとんどの項目（生活費・収入・税率・為替 等）はWeb版の内部
  // キー名とたまたま一致しているが、Stock（保有銘柄）・Correlation（相関係数）・
  // dividend_setting（配当設定）の3つだけ、Android側が大文字始まり／
  // アンダースコア区切りのキー名を使っており、Web版のキー名（小文字camelCase）
  // と一致しない。このズレにより「Android版の設定JSONを読み込むと保有銘柄・
  // 相関係数・配当設定が空欄になる」という不具合が発生していた。
  // 本関数はインポート時にAndroid形式のキー名をWeb版の内部形式へ変換する。
  // =====================================================

  /** 1件の保有銘柄データを Android形式(大文字始まり) → Web版内部形式(camelCase) に変換する */
  function normalizeStockRow(row) {
    // 既にWeb版形式（meigaraキーを持つ）ならそのまま返す
    if (row.meigara !== undefined) return row;
    if (row.Meigara === undefined) return row; // どちらの形式でもない場合はそのまま返す
    return {
      meigara: row.Meigara, kuchisu: row.Kuchisu, tani: row.Tani,
      currentValuePerUnit: row.CurrentValuePerUnit, averagePrice: row.AveragePrice,
      annualReturn: row.Return, volatility: row.Volatility,
      taxStartYearMonth: row.TaxStartYearMonth !== undefined ? row.TaxStartYearMonth : null,
      taxStartYear: row.TaxStartYear !== undefined ? row.TaxStartYear : null,
      taxStartMonth: row.TaxStartMonth !== undefined ? row.TaxStartMonth : null,
      exchangeRate: row.ExchangeRate || '',
      yahooFinanceCode: row.YahooFinanceCode || ''
    };
  }

  /**
   * 相関係数の銘柄名を、口座種別（＜...＞）を除いたベース銘柄名に変換する
   * （例:"SlimSP500＜特定＞"→"SlimSP500"）。相関係数タブの選択肢はベース銘柄名
   * のみになっているため、ここで統一しておかないとプルダウンの表示が正しく
   * 選択されない（先頭の選択肢が表示されてしまう）。
   */
  function extractBaseNameForSoukan(meigara) {
    if (!meigara) return meigara;
    const match = /^(.*?)＜[^＞]+＞$/.exec(meigara);
    return match ? match[1].trim() : meigara.trim();
  }

  /**
   * 1件の相関係数データを Android形式 → Web版内部形式 に変換し、銘柄名も
   * ベース銘柄名に統一する（Web版形式で保存されたデータでも、口座付きの
   * 銘柄名が残っている場合があるため、常にベース名への変換を行う）。
   */
  function normalizeSoukanRow(row) {
    const aMeigaraRaw = row.aMeigara !== undefined ? row.aMeigara : row.A_Meigara;
    const bMeigaraRaw = row.bMeigara !== undefined ? row.bMeigara : row.B_Meigara;
    return {
      aMeigara: extractBaseNameForSoukan(aMeigaraRaw),
      bMeigara: extractBaseNameForSoukan(bMeigaraRaw),
      keisu: row.keisu
    };
  }

  /**
   * 相関係数の配列を「ベース銘柄名ペア」単位で重複排除する。口座ごとに冗長化していた
   * 古いデータ（例: 同じ2銘柄の組み合わせが、口座の数だけ何十件も並んでいる状態）を
   * インポートした場合に、一覧に大量の重複行が表示されてしまうのを防ぐ。
   * 同じペアが複数件ある場合は、係数の平均値を採用して1件にまとめる
   * （エンジン側の計算でも同様に平均化されるため、結果に影響はない）。
   */
  function deduplicateSoukanByBaseNamePair(soukanRows) {
    const sumByKey = {};
    const countByKey = {};
    const orderedKeys = [];

    soukanRows.forEach((row) => {
      if (!row.aMeigara || !row.bMeigara || row.aMeigara === row.bMeigara) return;
      const key = row.aMeigara < row.bMeigara
        ? row.aMeigara + '\u0000' + row.bMeigara
        : row.bMeigara + '\u0000' + row.aMeigara;
      if (sumByKey[key] === undefined) {
        sumByKey[key] = 0;
        countByKey[key] = 0;
        orderedKeys.push(key);
      }
      sumByKey[key] += row.keisu;
      countByKey[key] += 1;
    });

    return orderedKeys.map((key) => {
      const names = key.split('\u0000');
      // 小数第5位までの精度で平均化する（0.99999のような、あえて1.0を避けた
      // 係数設定が丸めで1.0に潰れてしまわないようにするため）
      const averagedKeisu = Math.round((sumByKey[key] / countByKey[key]) * 100000) / 100000;
      return { aMeigara: names[0], bMeigara: names[1], keisu: averagedKeisu };
    });
  }

  /** 1件の配当設定データを Android形式 → Web版内部形式 に変換する */
  function normalizeDividendRow(row) {
    if (row.meigaraKey !== undefined) return row;
    if (row.MeigaraKey === undefined) return row;
    return {
      meigaraKey: row.MeigaraKey, dividendRate: row.DividendRate,
      paymentMonths: row.PaymentMonths || [], taxAdjustment: row.TaxAdjustment || '調整なし'
    };
  }

  // =====================================================
  // エクスポート時: Web版内部形式 → Android形式への変換
  // （normalizeXxxRow系の逆変換。exportAppDataAsFile()から呼ばれる）
  // =====================================================

  /** 1件の保有銘柄データを Web版内部形式 → Android形式（大文字始まり）に変換する */
  function denormalizeStockRow(stock) {
    return {
      Meigara: stock.meigara, Kuchisu: stock.kuchisu, Tani: stock.tani,
      CurrentValuePerUnit: stock.currentValuePerUnit, AveragePrice: stock.averagePrice,
      Return: stock.annualReturn, Volatility: stock.volatility,
      TaxStartYearMonth: stock.taxStartYearMonth || null,
      TaxStartYear: stock.taxStartYear || 0, TaxStartMonth: stock.taxStartMonth || 0,
      ExchangeRate: stock.exchangeRate || '', YahooFinanceCode: stock.yahooFinanceCode || ''
    };
  }

  /**
   * 1件の相関係数データを Web版内部形式（ベース銘柄名のみ）→ Android形式に変換する。
   * Android版は、A_Meigara/B_Meigaraに「口座種別込みの完全な銘柄名」を要求し、
   * 内部でそこからベース名を再抽出して相関行列を組み立てる仕様になっている
   * （android/…/MonteCarloSimulator.kt の buildCholeskyMatrix を確認済み）。
   * そのため、Web側で保持しているベース名から、実際に登録されている銘柄の中で
   * 最初に一致する完全な銘柄名を探して埋め戻す。
   */
  function denormalizeSoukanRow(soukan, stocks) {
    function findFullMeigaraForBaseName(baseName) {
      const matched = stocks.find((s) => extractBaseNameForSoukan(s.meigara) === baseName);
      return matched ? matched.meigara : baseName;
    }
    return {
      A_Meigara: findFullMeigaraForBaseName(soukan.aMeigara),
      B_Meigara: findFullMeigaraForBaseName(soukan.bMeigara),
      keisu: soukan.keisu
    };
  }

  /** 1件の配当設定データを Web版内部形式 → Android形式に変換する */
  function denormalizeDividendRow(dividend) {
    return {
      MeigaraKey: dividend.meigaraKey, DividendRate: dividend.dividendRate,
      PaymentMonths: dividend.paymentMonths || [], TaxAdjustment: dividend.taxAdjustment || '調整なし'
    };
  }

  /**
   * appDataを、Android版がそのまま読み込める形式に変換する。
   * 保有銘柄・相関係数・配当設定の3箇所だけキー名の形式が異なるため、
   * ここで変換したうえでJSON化する（それ以外の項目はWeb版・Android版で
   * 同じキー名を使っているため、変換の必要がない）。
   */
  function convertAppDataToAndroidFormat(appData) {
    const converted = Object.assign({}, appData);
    converted.stocks = appData.stocks.map(denormalizeStockRow);
    converted.soukan = appData.soukan.map((s) => denormalizeSoukanRow(s, appData.stocks));
    converted.dividend_setting = appData.dividendSetting.map(denormalizeDividendRow);
    delete converted.dividendSetting;
    return converted;
  }

  /**
   * インポートしたappData（Android版 or Web版どちらの形式でも）を、
   * Web版の内部形式に正規化する。既にWeb版形式のデータには影響しない。
   */
  function normalizeImportedAppData(parsed) {
    const normalized = Object.assign({}, parsed);

    if (Array.isArray(normalized.stocks)) {
      normalized.stocks = normalized.stocks.map(normalizeStockRow);
    }
    if (Array.isArray(normalized.soukan)) {
      normalized.soukan = deduplicateSoukanByBaseNamePair(normalized.soukan.map(normalizeSoukanRow));
    }

    // 配当設定: Android版はトップレベルのキー名が "dividend_setting"（アンダースコア）
    if (Array.isArray(normalized.dividend_setting) &&
      (!Array.isArray(normalized.dividendSetting) || normalized.dividendSetting.length === 0)) {
      normalized.dividendSetting = normalized.dividend_setting.map(normalizeDividendRow);
    }
    if (Array.isArray(normalized.dividendSetting)) {
      normalized.dividendSetting = normalized.dividendSetting.map(normalizeDividendRow);
    }
    delete normalized.dividend_setting;

    // 確率的インフレ変動モデル: 旧仕様（為替との固定相関係数）からの移行。
    // 旧フィールド名"correlationStrength"のデータが残っている場合、値（weak/normal/strong）は
    // そのまま新フィールド"regimeIntensity"（レジームの影響度）に引き継ぐ。
    if (normalized.inflationModelConfig) {
      const inf = Object.assign({}, normalized.inflationModelConfig);
      if (inf.regimeIntensity === undefined && inf.correlationStrength !== undefined) {
        inf.regimeIntensity = inf.correlationStrength;
      }
      delete inf.correlationStrength;
      normalized.inflationModelConfig = inf;
    }

    return normalized;
  }

  /** appData を localStorage に保存する */
  function saveAppData(appData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      return true;
    } catch (e) {
      console.error('保存に失敗しました:', e);
      return false;
    }
  }

  /** localStorage から appData を読み込む。存在しなければデフォルト値を返す */
  function loadAppData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultAppData();
      const parsed = JSON.parse(raw);
      // 後方互換: 新規追加フィールドが欠けている場合はデフォルト値で補完する
      return Object.assign(createDefaultAppData(), normalizeImportedAppData(parsed));
    } catch (e) {
      console.error('読み込みに失敗しました。デフォルト値を使用します:', e);
      return createDefaultAppData();
    }
  }

  /** appData をJSONファイルとしてダウンロードする（Android版が読み込める形式に変換してから書き出す） */
  function exportAppDataAsFile(appData) {
    const androidFormatData = convertAppDataToAndroidFormat(appData);
    const json = JSON.stringify(androidFormatData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = formatTimestampForFileName(new Date());
    a.href = url;
    a.download = 'FIRE_設定_' + timestamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** ファイル名用のタイムスタンプ文字列（yyyyMMdd_HHmmss）を生成する */
  function formatTimestampForFileName(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' +
      pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  }

  /**
   * JSONファイルを読み込んで appData に反映する。
   * @param {File} file ファイル選択で得られたFileオブジェクト
   * @param {function} onSuccess 成功時コールバック(appData)
   * @param {function} onError 失敗時コールバック(errorMessage)
   */
  function importAppDataFromFile(file, onSuccess, onError) {
    const reader = new FileReader();
    reader.onload = function (event) {
      try {
        const parsed = JSON.parse(event.target.result);
        const merged = Object.assign(createDefaultAppData(), normalizeImportedAppData(parsed));
        onSuccess(merged);
      } catch (e) {
        onError('JSONファイルの読み込みに失敗しました: ' + e.message);
      }
    };
    reader.onerror = function () { onError('ファイルの読み込みに失敗しました。'); };
    reader.readAsText(file);
  }

  global.FireState = {
    createDefaultAppData, createDefaultInflationCategories,
    saveAppData, loadAppData, exportAppDataAsFile, importAppDataFromFile,
    normalizeImportedAppData, convertAppDataToAndroidFormat
  };
})(typeof window !== 'undefined' ? window : globalThis);
