/**
 * ===============================================================
 * FIREシミュレーション コアエンジン（モンテカルロ法） - JavaScript版
 * ===============================================================
 *
 * 【本ファイルについて】
 * Android版アプリ（Kotlin）の MonteCarloSimulator.kt / Bond.kt /
 * RetirementTaxCalculator.kt をブラウザで動作するJavaScriptに移植したもの。
 * ロジックはKotlin版とできる限り1:1に対応させている。
 *
 * 【処理の流れ】
 *   1. 相関行列をコレスキー分解して相関付き乱数を生成できるよう準備する
 *   2. 毎月、Box-Muller法で生成した正規乱数に相関を付与し株価の月次リターンを決定する
 *   3. 為替レートはOrnstein-Uhlenbeck過程（平均回帰モデル）で変動させる
 *   4. 収入・出費・配当・追加投資を月次に処理し、不足分は売却優先順位に従って資産を売却する
 *   5. 指定試行数だけ繰り返し、FIRE成功率とサマリー統計を算出する
 *
 * グローバルオブジェクト window.FireEngine として公開する（モジュールを使わず
 * <script>タグで読み込むだけで動作するようにするため）。
 * ===============================================================
 */
(function (global) {
  'use strict';

  // =====================================================
  // 行列演算（モンテカルロ法の相関乱数生成に使用）
  // =====================================================

  /** rows × cols の行列を生成し、全要素を value で初期化する */
  function matRep(rows, cols, value) {
    value = value || 0.0;
    const m = new Array(rows);
    for (let i = 0; i < rows; i++) {
      m[i] = new Array(cols).fill(value);
    }
    return m;
  }

  /** 行列の積 a × b を計算する */
  function matDot(a, b) {
    const result = matRep(a.length, b[0].length);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b[0].length; j++) {
        for (let k = 0; k < b.length; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    return result;
  }

  /** n×n の単位行列を生成する（相関行列が分解できない場合の無相関フォールバックに使用） */
  function matIdentity(n) {
    const m = matRep(n, n);
    for (let i = 0; i < n; i++) m[i][i] = 1.0;
    return m;
  }

  /**
   * 相関行列 r をコレスキー分解し、下三角行列 L（r = L × L^T）を返す。
   * L に標準正規乱数ベクトルを掛けることで、指定した相関を持つ乱数を生成できる。
   * 相関行列が正定値でない場合（矛盾した相関設定など）は例外を投げる。
   * （※アルゴリズム名：コレスキー分解 / Cholesky decomposition）
   */
  function matCholesky(r) {
    const n = r.length;
    const l = matRep(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        if (i === j) {
          let sum = 0.0;
          for (let k = 0; k < j; k++) sum += l[j][k] * l[j][k];
          const diagVal = r[i][i] - sum;
          if (diagVal < 0) {
            throw new Error('コレスキー分解エラー: 相関行列に矛盾があります (diagVal=' + diagVal + ')');
          }
          l[i][j] = Math.sqrt(diagVal);
        } else {
          let sum = 0.0;
          for (let k = 0; k < j; k++) sum += l[i][k] * l[j][k];
          l[i][j] = (l[j][j] === 0.0) ? 0.0 : (r[i][j] - sum) / l[j][j];
        }
      }
    }
    return l;
  }

  /** Box-Muller法で標準正規乱数を生成する */
  function randomNormal() {
    let u = 0.0, v = 0.0;
    while (u === 0.0) u = Math.random();
    while (v === 0.0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // =====================================================
  // 小さなユーティリティ（Kotlinの coerceAtLeast 等に相当）
  // =====================================================
  function coerceAtLeast(x, min) { return x < min ? min : x; }
  function coerceAtMost(x, max) { return x > max ? max : x; }
  function coerceIn(x, min, max) { return Math.min(Math.max(x, min), max); }

  // =====================================================
  // 月次税率の計算
  // =====================================================

  /**
   * 指定した月の譲渡益課税率を返す。
   * taxEvents（税制変更イベント）のうち、monthIndex以前で最も新しい変更を適用する。
   * 該当イベントがなければデフォルトの20.315%（所得税15.315%＋住民税5%）を返す。
   */
  function calculateTaxRate(monthIndex, taxEvents) {
    let rate = 0.20315;
    const applicable = taxEvents
      .filter((e) => monthIndex >= e.month)
      .sort((a, b) => a.month - b.month);
    if (applicable.length > 0) {
      rate = applicable[applicable.length - 1].rate / 100.0;
    }
    return Math.floor(rate * 1000000.0) / 1000000.0;
  }

  // =====================================================
  // 配当処理
  // =====================================================

  /**
   * 当月の配当収入と配当税額を計算する。
   * dividendSetting（銘柄別の配当設定）のうち当月が支払月に該当する銘柄について、
   * 評価額×配当率で配当額を算出し、旧NISA課税開始状況に応じた税率で課税した上で
   * 基準価額を配当落ち分だけ下落させる（権利落ち処理）。
   * @return {gain: 税引き後配当合計, gainTax: 配当税合計}
   */
  function processDividend(monthIndex, startMonth, currentStocks, taxRate, appData) {
    let gain = 0.0;
    let gainTax = 0.0;
    // シミュレーション開始月を固定して配当月を計算（実行日依存を排除）
    const targetMonth = ((startMonth + monthIndex) % 12) + 1; // 1-12

    appData.dividendSetting.forEach((setting) => {
      if (setting.paymentMonths.indexOf(targetMonth) === -1) return;
      currentStocks.forEach((stock) => {
        if (stock.meigara !== setting.meigaraKey) return;

        // 評価額 = 基準価額 × 口数 ÷ 単位
        const hyouka = (stock.currentValuePerUnit * stock.kuchisu) / stock.tani;
        const ritu = setting.dividendRate / 100.0 / setting.paymentMonths.length;
        let wGain = hyouka * ritu;
        let tax = 0.0;

        if (stock.taxStartYear !== null && stock.taxStartMonth !== null) {
          if (stock.taxStartYear * 12 + stock.taxStartMonth <= monthIndex) {
            tax = setting.taxAdjustment === '調整あり' ? taxRate : taxRate + 0.1;
          } else {
            tax = 0.1;
          }
        }
        const wGainTax = Math.ceil(wGain * tax);
        wGain -= wGainTax;
        gain += wGain;
        gainTax += wGainTax;
        stock.currentValuePerUnit *= (1.0 - ritu);
      });
    });
    return { gain, gainTax };
  }

  // =====================================================
  // 収入・出費の処理
  // =====================================================

  /**
   * 当月の収入（給与等の収入イベント＋手動登録債券の利息・満期返金）を現金に加算し、
   * 生活費・大きな出費を差し引く。現金で賄いきれない分は requiredAssetSale として返し、
   * 呼び出し元（runOneTrial）で投資資産の売却・現金バッファ取り崩しにつなげる。
   */
  function handleIncomeAndExpense(params) {
    const {
      monthIndex, currentCash, appData, monthlyLifeCost, taxRate,
      currentFxRates, simStartYear, simStartMonth
    } = params;

    let cash = currentCash;
    let monthlyIncome = 0.0;

    // ---- 通常の収入イベント（給与・副収入等）----
    appData.income
      .filter((inc) => monthIndex >= inc.startTotalMonths &&
        (inc.endTotalMonths === null || monthIndex <= inc.endTotalMonths))
      .forEach((inc) => { monthlyIncome += inc.amount; });
    cash += monthlyIncome;

    // ---- 債券利息収入・満期返金の処理 ----
    const totalMonthsFromEpoch = (simStartYear * 12 + simStartMonth - 1) + monthIndex;
    const currentYear = Math.floor(totalMonthsFromEpoch / 12);
    const currentMonth = (totalMonthsFromEpoch % 12) + 1; // 1〜12

    let bondIncome = 0.0;
    appData.bonds.forEach((bond) => {
      // ---- 利息収入: 利息振込月に一致する場合に加算 ----
      if (bond.paymentMonths.indexOf(currentMonth) !== -1) {
        const couponFx = FireBond.couponPerPayment(bond);

        if (bond.currency === 'JPY') {
          bondIncome += couponFx;
        } else {
          const fxPairKey = FireBond.fxPairKey(bond.currency);
          const receiveFxRate = currentFxRates[fxPairKey] || 1.0;
          const couponJpy = couponFx * receiveFxRate;

          const avgPurchaseFx = FireBond.averagePurchaseFxRate(bond);
          const fxGainJpy = couponFx * (receiveFxRate - avgPurchaseFx);
          const couponFxTax = coerceAtLeast(fxGainJpy, 0.0) * taxRate;

          bondIncome += couponJpy - couponFxTax;
        }
      }

      // ---- 満期返金+税金計算: 満期年月と現在の年月が一致する場合に処理 ----
      const maturityParts = bond.maturityYM.split('-');
      if (maturityParts.length === 2) {
        const maturityYear = parseInt(maturityParts[0], 10) || 0;
        const maturityMonth = parseInt(maturityParts[1], 10) || 0;
        if (maturityYear === currentYear && maturityMonth === currentMonth) {
          const maturityFxRate = bond.currency === 'JPY'
            ? 1.0
            : (currentFxRates[FireBond.fxPairKey(bond.currency)] || 1.0);
          const taxResult = FireBond.calculateMaturityTax(bond, maturityFxRate, taxRate);
          bondIncome += taxResult.netPaymentJpy;
        }
      }
    });

    monthlyIncome += bondIncome;
    cash += bondIncome;

    // ---- 大きな出費 ----
    let bigExpense = 0.0;
    appData.bigExpense
      .filter((e) => e.month === monthIndex)
      .forEach((e) => { bigExpense += e.amount; });

    const totalExpense = monthlyLifeCost + bigExpense;
    let requiredAssetSale = 0.0;
    if (cash >= totalExpense) {
      cash -= totalExpense;
    } else {
      requiredAssetSale = totalExpense - cash;
      cash = 0.0;
    }
    return { cash, monthlyIncome, totalExpense, requiredAssetSale };
  }

  // =====================================================
  // 追加投資の処理
  // =====================================================

  /**
   * 当月に発動する追加投資イベント（各月／各年／１回）を処理し、対象銘柄を買い付ける。
   * 現金が不足するイベントはスキップする。買い付けにより口数・平均取得価額を更新する。
   */
  function handleAdditionalInvestment(monthIndex, currentCash, currentStocks, appData, simStartMonth) {
    let cash = currentCash;
    let totalInvestment = 0.0;
    const meigaraNames = currentStocks.map((s) => s.meigara);

    const actualMonthNum = ((simStartMonth - 1 + monthIndex) % 12) + 1;

    const events = appData.tuika.filter((tui) => {
      if (tui.month > monthIndex || tui.toMonthTotalMonths < monthIndex) return false;
      if (tui.pattern === '各月') return true;
      if (tui.pattern === '１回') return tui.month === monthIndex;
      return actualMonthNum === tui.fromMonthNum; // 「各年」
    });

    events.forEach((tuika) => {
      const idx = meigaraNames.indexOf(tuika.meigara);
      if (idx === -1) return;
      const stock = currentStocks[idx];
      const amount = tuika.amount;
      if (cash < amount) return;

      cash -= amount;
      totalInvestment += amount;

      const pricePerUnit = stock.currentValuePerUnit / stock.tani;
      if (pricePerUnit <= 0) return;
      const bought = Math.floor(amount / pricePerUnit);

      const oldTotal = stock.kuchisu * (stock.averagePrice / stock.tani);
      const newKuchisu = stock.kuchisu + bought;
      stock.kuchisu = newKuchisu;
      if (newKuchisu > 0) {
        const newTotal = oldTotal + amount;
        stock.averagePrice = (newTotal / newKuchisu) * stock.tani;
      }
    });
    return { cash, totalInvestment };
  }

  // =====================================================
  // 資産売却の処理
  //
  // 【売却優先順位】（仕様）
  //   優先度1: 特定口座・一般口座（課税口座・即課税）
  //   優先度2: 旧NISA（非課税期間終了後・課税が始まった資産）
  //   優先度3: 旧NISA（非課税期間中・いずれ課税になる資産）
  //   優先度4: 新NISA（恒久非課税・最後まで温存する）
  // =====================================================

  /** 銘柄の売却優先順位を返す（数値が小さいほど先に売却） */
  function saleOrder(s, monthIndex) {
    const isKazeiAccountByName = s.meigara.indexOf('＜特定＞') !== -1 || s.meigara.indexOf('＜一般＞') !== -1;
    const isNisaAccountByName = s.meigara.indexOf('＜新NISA＞') !== -1 ||
      s.meigara.indexOf('＜積立(新NISA)＞') !== -1 || s.meigara.indexOf('＜成長(新NISA)＞') !== -1;
    const isKyuNisaByName = s.meigara.indexOf('＜旧NISA＞') !== -1;

    if (s.taxStartYear !== null && s.taxStartYear === 0) return 1;
    if (s.taxStartYear === null && isKazeiAccountByName) return 1;
    if (s.taxStartYear !== null && s.taxStartYear > 0 &&
      s.taxStartYear * 12 + (s.taxStartMonth || 0) <= monthIndex) return 2;
    if (s.taxStartYear !== null && s.taxStartYear > 0 &&
      s.taxStartYear * 12 + (s.taxStartMonth || 0) > monthIndex) return 3;
    if (s.taxStartYear === null && isKyuNisaByName) return 3;
    if (s.taxStartYear === null) return 4;
    return 5;
  }

  /** 1口あたりの税引き後手取り額（課税銘柄）または売値（非課税銘柄）を返す */
  function calcUnitNet(s, taxRate, monthIndex) {
    const unitPrice = s.currentValuePerUnit / s.tani;
    if (unitPrice <= 0.0) return 0.0;
    const order = saleOrder(s, monthIndex);
    if (order <= 2) {
      const unitAvgPrice = s.averagePrice / s.tani;
      const unitGain = unitPrice - unitAvgPrice;
      const unitTax = unitGain > 0.0 ? unitGain * taxRate : 0.0;
      return unitPrice - unitTax;
    }
    return unitPrice;
  }

  /** 1口を売却したときの税額を返す。非課税銘柄は 0.0 */
  function calcUnitTax(s, taxRate, monthIndex) {
    const order = saleOrder(s, monthIndex);
    if (order > 2) return 0.0;
    const unitPrice = s.currentValuePerUnit / s.tani;
    const unitAvgPrice = s.averagePrice / s.tani;
    const unitGain = unitPrice - unitAvgPrice;
    return unitGain > 0.0 ? unitGain * taxRate : 0.0;
  }

  /** 銘柄がiDeCo口座（銘柄名に＜iDeCo＞を含む）かどうかを判定する */
  function isIdecoStock(s) { return s.meigara.indexOf('＜iDeCo＞') !== -1; }

  /**
   * "yyyy-MM" 形式の年月を「西暦年×12＋月」の整数に変換する。
   * ゼロ埋めされていない月（例:"2054-4"）でも正しく解釈できる。形式が不正ならnull。
   */
  function yearMonthToTotalMonths(ym) {
    if (!ym) return null;
    const parts = ym.split('-');
    if (parts.length !== 2) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return null;
    return y * 12 + m;
  }

  /** "yyyy-MM" 形式の2つの年月の間の経過年数（端数切り捨て）を計算する */
  function yearsBetweenYearMonth(from, to) {
    const fromMonths = yearMonthToTotalMonths(from);
    const toMonths = yearMonthToTotalMonths(to);
    if (fromMonths === null || toMonths === null) return 0;
    return coerceAtLeast(Math.floor((toMonths - fromMonths) / 12), 0);
  }

  /**
   * iDeCo一時金の退職所得控除計算に用いる「iDeCo加入年数」（＝掛金拠出年数）を算出する。
   */
  function calculateIdecoContributionYears(appData, idecoStartYearMonth, idecoReceiveYearMonth) {
    const startTotalMonths = yearMonthToTotalMonths(idecoStartYearMonth);
    if (startTotalMonths === null) return 0;
    const receiveTotalMonths = yearMonthToTotalMonths(idecoReceiveYearMonth);
    if (receiveTotalMonths === null) {
      return yearsBetweenYearMonth(idecoStartYearMonth, idecoReceiveYearMonth);
    }

    const idecoTuikaEntries = appData.tuika.filter((t) => t.meigara.indexOf('＜iDeCo＞') !== -1);

    let contributionEndTotalMonths;
    if (idecoTuikaEntries.length === 0 || idecoTuikaEntries.some((t) => !t.toMonth)) {
      contributionEndTotalMonths = receiveTotalMonths;
    } else {
      const ends = idecoTuikaEntries
        .map((t) => yearMonthToTotalMonths(t.toMonth))
        .filter((v) => v !== null);
      contributionEndTotalMonths = ends.length > 0 ? Math.max.apply(null, ends) : receiveTotalMonths;
    }

    return coerceAtLeast(Math.floor((contributionEndTotalMonths - startTotalMonths) / 12), 0);
  }

  /**
   * iDeCo口座の資産が、まだ受給年月に達しておらず売却できない状態かどうかを判定する。
   */
  function isIdecoLocked(s, simCurrentTotalMonths, idecoReceiveTotalMonths) {
    if (!isIdecoStock(s)) return false;
    if (idecoReceiveTotalMonths === null || idecoReceiveTotalMonths === undefined) return true;
    return simCurrentTotalMonths < idecoReceiveTotalMonths;
  }

  /** 売却優先順位に従って銘柄リストをソートして返す（同一優先度内は登録順を維持） */
  function sortedBySaleOrder(stocks, monthIndex) {
    return stocks
      .map((s, idx) => ({ s, idx }))
      .sort((a, b) => {
        const diff = saleOrder(a.s, monthIndex) - saleOrder(b.s, monthIndex);
        return diff !== 0 ? diff : a.idx - b.idx;
      })
      .map((x) => x.s);
  }

  /**
   * 生活費・大きな出費の不足額（requiredExpense）を賄うため、投資資産を売却順位に
   * 従って売却する。全資産を売却しても不足額に届かない場合は failed=true を返す。
   */
  function handleAssetSale(requiredExpense, currentCash, currentStocks, taxRate, monthIndex,
    simCurrentTotalMonths, idecoReceiveTotalMonths) {
    if (requiredExpense <= 0) {
      return { cash: Math.floor(currentCash), tax: 0.0, sellProceeds: 0.0, failed: false };
    }

    const neededAmount = coerceAtLeast(requiredExpense - currentCash, 0.0);

    const sellableStocks = currentStocks.filter(
      (s) => !isIdecoLocked(s, simCurrentTotalMonths, idecoReceiveTotalMonths));

    const totalAsset = sellableStocks.reduce(
      (sum, s) => sum + (s.currentValuePerUnit / s.tani) * s.kuchisu, 0.0);
    if (sellableStocks.length === 0 || totalAsset < neededAmount) {
      return { cash: 0.0, tax: 0.0, sellProceeds: 0.0, failed: true };
    }

    let remaining = neededAmount;
    let totalSales = 0.0;
    let totalTax = 0.0;

    for (const stock of sortedBySaleOrder(sellableStocks, monthIndex)) {
      if (remaining <= 0.0) break;
      if (stock.kuchisu <= 0) continue;
      const unitPrice = stock.currentValuePerUnit / stock.tani;
      if (unitPrice <= 0.0) continue;
      const unitNet = calcUnitNet(stock, taxRate, monthIndex);
      if (unitNet <= 0.0) continue;

      const targetKuchisu = Math.ceil(remaining / unitNet);
      const actual = Math.min(targetKuchisu, stock.kuchisu);
      if (actual <= 0) continue;

      const gross = actual * unitPrice;
      const taxPaid = actual * calcUnitTax(stock, taxRate, monthIndex);

      remaining -= (gross - taxPaid);
      totalSales += gross;
      totalTax += taxPaid;
      stock.kuchisu -= actual;
    }

    const failed = remaining > 0.0;
    const finalCash = failed ? 0.0 : coerceAtLeast(Math.floor(totalSales - totalTax - neededAmount), 0.0);

    return { cash: finalCash, tax: totalTax, sellProceeds: totalSales, failed };
  }

  // =====================================================
  // 現金バッファ戦略: ステートマシンのモード遷移判定
  // NORMAL → CRISIS: ドローダウンが crashThresholdPct を超えたとき
  // CRISIS → NORMAL: ドローダウンが recoveryThresholdPct 以下に回復したとき
  // =====================================================

  function updateCashBufferMode(currentMode, drawdownPct, crashThresholdPct, recoveryThresholdPct) {
    if (currentMode === 'NORMAL' || currentMode === 'REFILL') {
      return drawdownPct > crashThresholdPct ? 'CRISIS' : currentMode;
    }
    // CRISIS
    return drawdownPct <= recoveryThresholdPct ? 'NORMAL' : 'CRISIS';
  }

  // =====================================================
  // 国債バッファ処理（変動10年国債をキャッシュバッファとして利用）
  // =====================================================

  /** ロットが1年以上保有され途中売却可能かどうかを判定する */
  function jgbLotIsRedeemable(lot, currentYear, currentMonth) {
    const parts = (lot.purchaseYM || '').split('-');
    if (parts.length !== 2) return false;
    const buyYear = parseInt(parts[0], 10);
    const buyMonth = parseInt(parts[1], 10);
    if (isNaN(buyYear) || isNaN(buyMonth)) return false;
    const monthsHeld = (currentYear - buyYear) * 12 + (currentMonth - buyMonth);
    return monthsHeld >= 12;
  }

  /** 途中売却時の手取り額（直近2回分の利息ペナルティ控除後）を計算する */
  function jgbLotEarlyRedemptionProceeds(lot) {
    const principal = lot.faceValue * lot.quantity;
    const penaltyInterest = principal * lot.couponRate / 100.0;
    return coerceAtLeast(principal - penaltyInterest, 0.0);
  }

  /**
   * 国債バッファからの中途換金処理（CRISISモード中に生活費が不足した場合）。
   * 1年以上保有しているロットを古い順に売却して必要額を調達する。
   */
  function redeemJgbLotsForCash(needed, currentYear, currentMonth, jgbLots) {
    let raised = 0.0;
    let stillNeeded = needed;
    const remainingLots = [];

    const sortedLots = jgbLots.slice().sort((a, b) => (a.purchaseYM < b.purchaseYM ? -1 : 1));

    for (const lot of sortedLots) {
      if (stillNeeded <= 0.0 || !jgbLotIsRedeemable(lot, currentYear, currentMonth)) {
        remainingLots.push(lot);
        continue;
      }

      const lotProceeds = jgbLotEarlyRedemptionProceeds(lot);
      if (lotProceeds <= stillNeeded) {
        raised += lotProceeds;
        stillNeeded -= lotProceeds;
        // このロットはremainingLotsに加えない（＝全数売却済み）
      } else {
        const unitProceeds = lot.faceValue * (1.0 - lot.couponRate / 100.0);
        const neededUnits = unitProceeds > 0.0
          ? coerceIn(Math.ceil(stillNeeded / unitProceeds), 1, lot.quantity)
          : lot.quantity;

        if (neededUnits >= lot.quantity) {
          raised += lotProceeds;
          stillNeeded -= lotProceeds;
        } else {
          const soldPrincipal = lot.faceValue * neededUnits;
          const soldPenalty = soldPrincipal * lot.couponRate / 100.0;
          const soldProceeds = soldPrincipal - soldPenalty;
          raised += soldProceeds;
          stillNeeded -= soldProceeds;
          remainingLots.push(Object.assign({}, lot, { quantity: lot.quantity - neededUnits }));
        }
      }
    }

    return { raised, remainingLots };
  }

  /** 国債バッファロットの合計保有額を計算する（額面×口数の合計） */
  function calcJgbTotalValue(jgbLots) {
    return jgbLots.reduce((sum, lot) => sum + lot.faceValue * lot.quantity, 0.0);
  }

  /**
   * 現金補充専用の売却処理。指定された目標補充額を得るために必要な株数を売却し、
   * 税引き後の手取り補充額を cash に格納して返す。
   */
  function sellForCashRefill(targetRefillAmount, currentStocks, taxRate, monthIndex,
    simCurrentTotalMonths, idecoReceiveTotalMonths) {
    if (targetRefillAmount <= 0.0) return { cash: 0.0, tax: 0.0, sellProceeds: 0.0, failed: false };

    let remaining = targetRefillAmount;
    let totalSales = 0.0;
    let totalTax = 0.0;

    const sellableStocks = currentStocks.filter(
      (s) => !isIdecoLocked(s, simCurrentTotalMonths, idecoReceiveTotalMonths));

    for (const stock of sortedBySaleOrder(sellableStocks, monthIndex)) {
      if (remaining <= 0.0) break;
      if (stock.kuchisu <= 0) continue;
      const unitPrice = stock.currentValuePerUnit / stock.tani;
      if (unitPrice <= 0.0) continue;
      const unitNet = calcUnitNet(stock, taxRate, monthIndex);
      if (unitNet <= 0.0) continue;
      const targetKuchisu = Math.ceil(remaining / unitNet);
      const actual = Math.min(targetKuchisu, stock.kuchisu);
      if (actual <= 0) continue;
      const gross = actual * unitPrice;
      const taxPaid = actual * calcUnitTax(stock, taxRate, monthIndex);
      remaining -= (gross - taxPaid);
      totalSales += gross;
      totalTax += taxPaid;
      stock.kuchisu -= actual;
    }

    const netProceeds = coerceAtLeast(totalSales - totalTax, 0.0);
    const failed = remaining > 0.0;
    return { cash: netProceeds, tax: totalTax, sellProceeds: totalSales, failed };
  }

  /**
   * 現金バッファ（useJgbBuffer=falseの場合）をREFILL相当のタイミングで補充する。
   * 目標額との不足分を12ヶ月かけて均等に投資資産の売却で埋めていく。
   */
  function handleCashBufferRefill(cashBufferTarget, currentCash, currentStocks, taxRate, monthIndex,
    simCurrentTotalMonths, idecoReceiveTotalMonths) {
    const shortage = cashBufferTarget - currentCash;
    const monthlyRefill = shortage / 12.0;
    if (monthlyRefill <= 0.0) return { cash: 0.0, tax: 0.0, sellProceeds: 0.0, failed: false };

    return sellForCashRefill(monthlyRefill, currentStocks, taxRate, monthIndex,
      simCurrentTotalMonths, idecoReceiveTotalMonths);
  }

  /**
   * 国債バッファの補充処理（REFILLモード中）。
   * 不足額を12ヶ月で補充するペースで、毎月投資資産を売却して国債を購入する。
   */
  function refillJgbBuffer(params) {
    const {
      cashBufferTarget, currentJgbValue, currentStocks, taxRate, monthIndex,
      jgbCouponRate, currentYear, currentMonth, jgbLots,
      currentCash, allowAssetSale, simCurrentTotalMonths, idecoReceiveTotalMonths
    } = params;

    const shortage = cashBufferTarget - currentJgbValue;

    // 端数対策: 不足額が1ロット（1万円）未満なら購入しない
    if (shortage < 10000.0) {
      return { saleRes: { cash: 0.0, tax: 0.0, sellProceeds: 0.0, failed: false }, updatedLots: jgbLots, remainingCash: currentCash };
    }

    const maxBuyableByLot = Math.floor(shortage / 10000.0) * 10000.0;

    // ---- ステップ1: 余剰現金から購入する ----
    const cashAvailableByLot = Math.floor(currentCash / 10000.0) * 10000.0;
    const cashBuyAmount = coerceAtMost(maxBuyableByLot, cashAvailableByLot);

    // ---- ステップ2: 現金が足りない分は資産売却で補う（REFILLモード時のみ）----
    let assetBuyNeeded = 0.0;
    if (allowAssetSale) {
      const stillShortage = maxBuyableByLot - cashBuyAmount;
      assetBuyNeeded = stillShortage >= 10000.0 ? coerceAtMost(stillShortage / 12.0, stillShortage) : 0.0;
    }

    const saleRes = assetBuyNeeded >= 10000.0
      ? sellForCashRefill(assetBuyNeeded, currentStocks, taxRate, monthIndex, simCurrentTotalMonths, idecoReceiveTotalMonths)
      : { cash: 0.0, tax: 0.0, sellProceeds: 0.0, failed: false };

    const totalAvailable = currentCash + saleRes.cash;
    const actualLots = Math.floor(coerceAtMost(totalAvailable, maxBuyableByLot) / 10000.0);
    const actualBought = actualLots * 10000.0;
    const remainingCash = totalAvailable - actualBought;

    const updatedLots = jgbLots.slice();
    if (actualLots > 0) {
      const purchaseYM = currentYear + '-' + String(currentMonth).padStart(2, '0');
      updatedLots.push({ purchaseYM, faceValue: 10000.0, quantity: actualLots, couponRate: jgbCouponRate });
    }

    return { saleRes, updatedLots, remainingCash };
  }

  // =====================================================
  // 月次利率変動の適用
  // =====================================================

  /** 為替ペアごとのデフォルトパラメータ（ユーザー未設定時に使用） */
  const defaultExchangeRateParams = {
    'USD/JPY': { pair: 'USD/JPY', currentRate: 150.0, targetRate: 145.0, volatility: 10.0, reversionSpeed: 0.05 },
    'EUR/JPY': { pair: 'EUR/JPY', currentRate: 160.0, targetRate: 155.0, volatility: 10.0, reversionSpeed: 0.05 },
    'EUR/USD': { pair: 'EUR/USD', currentRate: 1.08, targetRate: 1.05, volatility: 8.0, reversionSpeed: 0.05 }
  };

  // =====================================================
  // インフレ・市場リターンのマクロ経済レジーム（体制）モデル
  // =====================================================
  //
  // 【旧実装（廃止）】
  // 以前は「有効化すると、インフレ率が為替（USD/JPY）と固定の相関係数
  // （弱い=0.2/普通=0.4/強い=0.6）で連動する」という単純な仕組みだった。
  // これはインフレが高い年ほど常に一定の正の相関で円安になる、という
  // 「単純な固定・線形の相関」であり、以下の現実的な現象を表現できなかった。
  //
  // 【この実装で解決したい現実の3つの現象】
  //   (1) 非線形（閾値的）な関係: マイルドなインフレ（0〜3%程度）は需要牽引で
  //       株高要因になりうる一方、行き過ぎたインフレは中央銀行の利上げ（金融引き締め）
  //       を通じてある閾値を境に株安要因へと転じる。
  //   (2) 時間差（ラグ）: インフレが急上昇した直後の1〜2年は、企業の価格転嫁が
  //       追いつかず株価が下押しされ、その後遅れてプラスに転じる。
  //   (3) 例外的な複数年レジーム: 上記の「平時のルール」に収まらない
  //       スタグフレーション（高インフレ×株安が同時発生）やゴルディロックス
  //       （低インフレ×株高が同時に続く）が、現実には数年単位で発生しうる。
  //
  // 【なぜ個別の後付けルールではなく「レジームのマルコフ連鎖」を採用したか】
  // (1)〜(3)を「閾値判定」「ショック年数カウンタ」「毎年の独立確率抽選」という
  // 3つの別々のルールとして積み上げる案も検討したが、以下の問題があった。
  //   ・(a) 閾値の前後で相関係数が不連続にジャンプし、シミュレーション上
  //         「インフレ率が3.0%か3.1%か」だけで挙動が激変する不自然な段差ができる。
  //   ・(b) 同じ年に複数のルールが重複して発動し、同じ方向の効果が二重に
  //         乗ってしまう（例: 閾値ルールで株安バイアスがかかっている年に、
  //         例外ノイズでさらにスタグフレーションが重ねて発生する等）。
  //   ・(c) 「毎年5%の独立確率」で判定すると、スタグフレーション等の平均持続期間が
  //         1年強にしかならず、現実の複数年続く特性（シーケンスリスクへの影響）を
  //         過小評価してしまう。
  // そこで、(1)〜(3)を「マクロ経済レジーム（体制）のマルコフ連鎖
  // （Markov chain、遷移確率行列に基づき確率的に状態遷移するモデル）」という
  // 単一の枠組みに統合した。
  //   ・毎年（シミュレーション上の1年ごと）、現在のレジームに応じた遷移確率で
  //     次の1年間のレジームを1つだけ抽選する
  //     （NORMAL / OVERHEAT / TIGHTENING / STAGFLATION / GOLDILOCKSの5状態）。
  //   ・各レジームは「インフレ率への加算」「株式年率リターンへの加算」
  //     「月次ボラティリティ倍率」をあらかじめ持ち、抽選されたレジームの効果が
  //     その1年間、毎月一律に（全銘柄共通のマクロ要因として）適用される。
  //   ・OVERHEAT（マイルドインフレ×株高）からTIGHTENING（インフレ昂進×株安）への
  //     遷移確率を高めに設定することで、(1)の非線形な閾値効果を
  //     「レジーム構造」として（不連続な係数反転を作らずに）表現している。
  //   ・TIGHTENING/STAGFLATIONは自己遷移確率（同じレジームが翌年も続く確率）を
  //     高めに設定しており、これが(2)のラグ効果（ショックが数年尾を引き、
  //     その後解消する）を自然に再現する。
  //   ・STAGFLATION/GOLDILOCKSは通常状態から一定確率で入り、かつ自己遷移確率が
  //     高いため、(3)の「複数年続く例外的レジーム」を、毎年の独立抽選ではなく
  //     持続性のある1つの遷移として表現できる。
  // この設計により、(1)〜(3)を重複なく・不連続を作らずに1つのモデルで実現している。

  /** マクロ経済レジームの一覧 */
  const REGIME_NAMES = ['NORMAL', 'OVERHEAT', 'TIGHTENING', 'STAGFLATION', 'GOLDILOCKS'];

  /**
   * 各レジームの基礎パラメータ（intensity="normal"を基準とする値）。
   * inflationDeltaPt: その年の基礎インフレ率（年率）に加算するポイント
   * stockReturnDeltaPt: 全銘柄共通で株式の年率リターンに加算するポイント（マクロ要因）
   * volMultiplier: 月次ボラティリティに掛ける倍率
   */
  const REGIME_BASE_PARAMS = {
    NORMAL: { inflationDeltaPt: 0.0, stockReturnDeltaPt: 0.0, volMultiplier: 1.0 },
    OVERHEAT: { inflationDeltaPt: 1.5, stockReturnDeltaPt: 3.0, volMultiplier: 1.0 },
    TIGHTENING: { inflationDeltaPt: 3.0, stockReturnDeltaPt: -6.0, volMultiplier: 1.3 },
    STAGFLATION: { inflationDeltaPt: 5.0, stockReturnDeltaPt: -12.0, volMultiplier: 1.6 },
    GOLDILOCKS: { inflationDeltaPt: -1.0, stockReturnDeltaPt: 5.0, volMultiplier: 0.8 }
  };

  /**
   * レジーム間の年次遷移確率行列（行=現在のレジーム、列=翌年のレジーム、各行の合計=1.0）。
   * OVERHEAT→TIGHTENINGの遷移確率(0.20)を他の遷移より高めにすることで、
   * 「マイルドインフレが行き過ぎると引き締めに転じる」非線形な閾値効果を表現している。
   * TIGHTENING/STAGFLATION/GOLDILOCKSの自己遷移確率（対角成分）を高めにすることで、
   * ショックの持続性（ラグ効果・複数年レジーム）を表現している。
   */
  const REGIME_TRANSITION_MATRIX = {
    NORMAL: { NORMAL: 0.78, OVERHEAT: 0.12, TIGHTENING: 0.04, STAGFLATION: 0.02, GOLDILOCKS: 0.04 },
    OVERHEAT: { NORMAL: 0.25, OVERHEAT: 0.45, TIGHTENING: 0.20, STAGFLATION: 0.05, GOLDILOCKS: 0.05 },
    TIGHTENING: { NORMAL: 0.30, OVERHEAT: 0.05, TIGHTENING: 0.45, STAGFLATION: 0.15, GOLDILOCKS: 0.05 },
    STAGFLATION: { NORMAL: 0.15, OVERHEAT: 0.03, TIGHTENING: 0.17, STAGFLATION: 0.60, GOLDILOCKS: 0.05 },
    GOLDILOCKS: { NORMAL: 0.25, OVERHEAT: 0.10, TIGHTENING: 0.03, STAGFLATION: 0.02, GOLDILOCKS: 0.60 }
  };

  /** UIの「弱い／普通／強い」に対応する、レジーム効果の強度スケール係数を返す */
  function regimeIntensityScale(intensity) {
    if (intensity === 'weak') return 0.5;
    if (intensity === 'strong') return 1.6;
    return 1.0; // "normal" およびそれ以外のデフォルト
  }

  /**
   * 指定したレジームについて、強度スケール適用後の実効パラメータを返す。
   * ボラティリティ倍率は「1.0からの乖離幅」をスケールする（強度を弱めるほど1.0に近づく）。
   */
  function effectiveRegimeParams(regime, intensity) {
    const base = REGIME_BASE_PARAMS[regime] || REGIME_BASE_PARAMS.NORMAL;
    const scale = regimeIntensityScale(intensity);
    return {
      inflationDeltaPt: base.inflationDeltaPt * scale,
      stockReturnDeltaPt: base.stockReturnDeltaPt * scale,
      volMultiplier: 1.0 + (base.volMultiplier - 1.0) * scale
    };
  }

  /**
   * マルコフ連鎖の遷移確率行列に従い、現在のレジームから次の1年間のレジームを1つ抽選する。
   */
  function drawNextRegime(currentRegime) {
    const row = REGIME_TRANSITION_MATRIX[currentRegime] || REGIME_TRANSITION_MATRIX.NORMAL;
    const rnd = Math.random();
    let cumulative = 0.0;
    for (let i = 0; i < REGIME_NAMES.length; i++) {
      const name = REGIME_NAMES[i];
      cumulative += row[name];
      if (rnd < cumulative) return name;
    }
    return REGIME_NAMES[REGIME_NAMES.length - 1]; // 丸め誤差対策のフォールバック
  }

  /**
   * 対数正規オルンシュタイン=ウーレンベック過程（Ornstein-Uhlenbeck process、平均回帰モデル）
   * で為替レートを1ステップ進める。
   */
  function oupRate(st, theta, mu, sigma, dt, dw) {
    if (st <= 0 || mu <= 0) return st;
    const nextLn = Math.log(st) + theta * (Math.log(mu) - Math.log(st)) * dt + sigma * dw;
    return Math.exp(nextLn);
  }

  /**
   * USD/JPY・EUR/JPY・EUR/USDの為替レートを1ステップ（dt年分）進める。
   * 各通貨ペアにOU過程を適用し、通貨ペア間の相関はコレスキー分解した相関行列で反映する。
   * （旧実装ではここにインフレとの相関次元を追加していたが、レジームモデルへの置き換えに伴い廃止し、
   * 為替ペア同士の相関のみを扱うシンプルな形に戻した）
   */
  function calculateNextExchangeRates(appData, previousRates, dt) {
    const pairs = ['USD/JPY', 'EUR/JPY', 'EUR/USD'];
    const n = pairs.length;

    const params = {};
    appData.exchangeRate.forEach((p) => { params[p.pair] = p; });
    pairs.forEach((pair) => {
      if (!params[pair]) params[pair] = defaultExchangeRateParams[pair];
    });

    const r = matIdentity(n);
    appData.exchangeRateCorrelations.forEach((c) => {
      const i = pairs.indexOf(c.pairA);
      const j = pairs.indexOf(c.pairB);
      if (i !== -1 && j !== -1) { r[i][j] = c.keisu; r[j][i] = c.keisu; }
    });

    let l;
    try { l = matCholesky(r); } catch (e) { l = matIdentity(n); }
    const z = Array.from({ length: n }, () => [randomNormal()]);
    const dw = matDot(l, z);
    const sqrtDt = Math.sqrt(dt);

    const result = {};
    pairs.forEach((pair, index) => {
      const p = params[pair];
      const prev = previousRates[pair] !== undefined ? previousRates[pair] : p.currentRate;
      result[pair] = oupRate(prev, p.reversionSpeed, p.targetRate, p.volatility / 100.0, dt, dw[index][0] * sqrtDt);
    });

    return { rates: result };
  }

  /**
   * 全銘柄に1ヶ月分のリターンを適用する。
   * コレスキー分解済みの相関行列 l を使い相関付き正規乱数を生成して対数正規分布
   * （log-normal distribution）で株価を更新し、為替レートも同時に1ヶ月分進める。
   * regimeParamsが指定されている場合（確率的インフレ変動モデルが有効な場合）、
   * その年のマクロ経済レジームによる株式年率リターンへの加算・ボラティリティ倍率を
   * 全銘柄共通のマクロ要因として上乗せする。
   */
  function applyMonthlyReturn(currentStocks, l, taxRate, currentExchangeRates, appData, monthIndex, saveDetails, regimeParams) {
    const n = currentStocks.length;
    const z = Array.from({ length: n }, () => [randomNormal()]);
    const y = matDot(l, z);

    const fxStepResult = calculateNextExchangeRates(appData, currentExchangeRates, 1.0 / 12.0);
    const nextRates = fxStepResult.rates;
    const fxReturns = {};
    Object.keys(nextRates).forEach((pair) => {
      const oldRate = currentExchangeRates[pair];
      fxReturns[pair] = (oldRate !== undefined && oldRate > 0.0) ? (nextRates[pair] / oldRate) - 1.0 : 0.0;
    });

    const details = [];
    let endAssets = 0.0;

    for (let i = 0; i < n; i++) {
      const stock = currentStocks[i];

      // レジームモデルが有効な場合、当年のレジームによる株式年率リターンへの加算・
      // ボラティリティ倍率を、個別銘柄設定に上乗せしたうえでGBMのパラメータを算出する
      const regimeReturnDeltaPt = regimeParams ? regimeParams.stockReturnDeltaPt : 0.0;
      const regimeVolMultiplier = regimeParams ? regimeParams.volMultiplier : 1.0;

      const annualRate = (stock.annualReturn + regimeReturnDeltaPt) / 100.0;
      const monthlyMu = Math.log(1.0 + annualRate) / 12.0;
      const monthlyVol = (stock.volatility / 100.0) * regimeVolMultiplier * Math.sqrt(1.0 / 12.0);
      const correlatedZ = y[i][0];

      // 幾何ブラウン運動（Geometric Brownian Motion）に基づく月次リターン
      const mcRate = Math.exp((monthlyMu - (monthlyVol * monthlyVol) / 2.0) + monthlyVol * correlatedZ) - 1.0;

      const fxRate = stock.exchangeRate ? (fxReturns[stock.exchangeRate] || 0.0) : 0.0;
      const monthlyRate = (1.0 + mcRate) * (1.0 + fxRate) - 1.0;

      if (stock.kuchisu <= 0) {
        if (saveDetails) {
          details.push({
            rate: monthlyRate * 100, value: 0.0, kuchisu: 0,
            currentValuePerUnit: 0, averagePrice: Math.round(stock.averagePrice),
            taxPerUnit: 0.0, monteCarlo: mcRate * 100, fxrate: fxRate * 100, tani: stock.tani
          });
        }
        continue;
      }

      stock.currentValuePerUnit *= (1.0 + monthlyRate);

      const value = stock.kuchisu * (stock.currentValuePerUnit / stock.tani);
      endAssets += value;

      if (saveDetails) {
        let taxPerUnit = 0.0;
        const isTaxable = saleOrder(stock, monthIndex) <= 2;
        if (isTaxable && stock.currentValuePerUnit > stock.averagePrice) {
          taxPerUnit = (stock.currentValuePerUnit - stock.averagePrice) / stock.tani * taxRate;
        }
        details.push({
          rate: monthlyRate * 100, value, kuchisu: stock.kuchisu,
          currentValuePerUnit: Math.round(stock.currentValuePerUnit), averagePrice: Math.round(stock.averagePrice),
          taxPerUnit, monteCarlo: mcRate * 100, fxrate: fxRate * 100, tani: stock.tani
        });
      }
    }

    return { stockDetails: details, endOfPeriodAssets: endAssets, nextExchangeRates: nextRates };
  }

  // =====================================================
  // カテゴリ別インフレ率の加重平均
  // =====================================================

  /** カテゴリリストから加重平均インフレ率（年率）を計算する */
  function calculateWeightedInflationRate(categories) {
    const activeCats = categories.filter((c) => c.monthlyAmount > 0);
    if (activeCats.length === 0) return 0.0;
    const totalAmount = activeCats.reduce((s, c) => s + c.monthlyAmount, 0.0);
    const annualRate = activeCats.reduce((s, c) => s + c.inflationRate * c.monthlyAmount, 0.0) / totalAmount / 100.0;
    return annualRate;
  }

  // =====================================================
  // 保有銘柄の相関行列（コレスキー分解）構築
  // =====================================================

  function getBaseName(meigara) {
    const m = /^(.*?)＜[^＞]+＞$/.exec(meigara);
    return m ? m[1].trim() : meigara.trim();
  }

  /**
   * 保有銘柄間の相関行列を構築し、コレスキー分解した下三角行列を返す。
   * 同一ベース名（同じ銘柄の異口座保有）は自動的に相関1.0とし、
   * それ以外はappData.soukanのユーザー設定値を「ベース名（銘柄）単位」に集約した
   * うえで適用する（未設定のベース名ペアは無相関）。
   */
  function buildCholeskyMatrix(appData) {
    const baseNames = appData.stocks.map((s) => getBaseName(s.meigara));
    const n = appData.stocks.length;
    const r = matIdentity(n);

    // ① soukanの設定を「ベース名ペア」単位に集約する。
    // ユーザーが選択したaMeigara/bMeigaraには、ベース銘柄名（例:"SlimSP500"）そのものが
    // 格納されている想定だが、古い設定データ等で口座種別付きの完全な銘柄名
    // （例:"SlimSP500＜特定＞"）が残っていても、getBaseNameを通すことでどちらの形式でも
    // 同じように扱えるようにしている（後方互換）。
    const baseCorrSum = {};
    const baseCorrCount = {};
    appData.soukan.forEach((item) => {
      const ba = getBaseName(item.aMeigara || '');
      const bb = getBaseName(item.bMeigara || '');
      if (baseNames.indexOf(ba) === -1 || baseNames.indexOf(bb) === -1) return;
      if (ba === bb) return;
      const key = ba < bb ? ba + '\u0000' + bb : bb + '\u0000' + ba;
      baseCorrSum[key] = (baseCorrSum[key] || 0.0) + item.keisu;
      baseCorrCount[key] = (baseCorrCount[key] || 0) + 1;
    });
    const baseCorr = {};
    Object.keys(baseCorrSum).forEach((key) => { baseCorr[key] = baseCorrSum[key] / baseCorrCount[key]; });

    // ② 同一ベース名の異口座間は完全相関（1.0）として自動設定する
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (baseNames[i] === baseNames[j]) { r[i][j] = 1.0; r[j][i] = 1.0; }
      }
    }

    // ③ 異なるベース名同士は、①で集約したベース名単位の相関係数を適用する
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (baseNames[i] === baseNames[j]) continue;
        const key = baseNames[i] < baseNames[j]
          ? baseNames[i] + '\u0000' + baseNames[j]
          : baseNames[j] + '\u0000' + baseNames[i];
        const corr = baseCorr[key];
        if (corr === undefined) continue;
        r[i][j] = corr; r[j][i] = corr;
      }
    }

    try { return matCholesky(r); } catch (e) { return matIdentity(r.length); }
  }

  /** 為替レートの初期値マップを構築する。ユーザー未設定の為替ペアはデフォルト値で補完する */
  function buildInitialRates(appData) {
    const rates = {};
    Object.keys(defaultExchangeRateParams).forEach((pair) => {
      rates[pair] = defaultExchangeRateParams[pair].currentRate;
    });
    appData.exchangeRate.forEach((e) => { rates[e.pair] = e.currentRate; });
    return rates;
  }

  // =====================================================
  // 1試行分の月次ループ（runSimulation / runSimulationWithShock 共通）
  // =====================================================

  /**
   * モンテカルロシミュレーションを1試行分実行する。
   * config.period年×12ヶ月の月次ループで、株価・為替変動、配当、収入・生活費・
   * 大きな出費・債券利息、追加投資、旧NISA課税開始、現金/国債バッファ戦略、
   * 資産売却・破綻判定までを毎月処理し、月次記録を積み上げて1試行分の結果を返す。
   */
  function runOneTrial(trialId, appData, l, initialRates, startMonth, saveDetailHistory, shockRateFn) {
    const config = appData.config;
    const stocks = appData.stocks;
    const totalPeriods = config.period * 12;

    const sortedPeriods = appData.lifeCostPeriods.slice()
      .sort((a, b) => (a.appliesFromYearMonth < b.appliesFromYearMonth ? -1 : 1));

    // シミュレーション開始年月（実行時点の年月を開始とみなす）
    const now = new Date();
    const simStartYear = now.getFullYear();
    const simStartMonth = now.getMonth() + 1;

    let currentPeriodIndex = 0;
    let currentCategories = sortedPeriods.length > 0 ? sortedPeriods[0].categories : [];
    let inflationRate = calculateWeightedInflationRate(currentCategories);
    let currentMonthlyLifeCost = currentCategories.reduce((s, c) => s + c.monthlyAmount, 0.0);

    // マクロ経済レジーム（確率的インフレ変動モデルが有効な場合のみ使用）。
    // 開始時点はNORMALとし、以後1年ごとにdrawNextRegime()で更新する。
    let currentRegime = 'NORMAL';
    let currentRegimeParams = appData.inflationModelConfig.enabled
      ? effectiveRegimeParams(currentRegime, appData.inflationModelConfig.regimeIntensity)
      : null;

    const cbConfigRaw = appData.cashBufferConfig;
    const cbConfig = cbConfigRaw.enabled
      ? cbConfigRaw
      : Object.assign({}, cbConfigRaw, { enabled: false, crashThresholdPct: 200.0 });

    let cashBufferMode = 'NORMAL';
    let jgbCouponThisMonth = 0.0;
    let idecoIncomeThisMonth = 0.0;
    let jgbPurchaseThisMonth = 0.0;

    let highWaterMark = stocks.reduce((s, st) => s + st.kuchisu * (st.currentValuePerUnit / st.tani), 0.0);
    let cashBufferTarget = currentMonthlyLifeCost * 12.0 * cbConfig.cashBufferYears;
    let jgbLots = (cbConfigRaw.jgbLots || []).slice();

    let currentCash = config.cash;

    let severancePaidOut = false;
    let idecoPaidOut = false;
    const idecoReceiveTotalMonths = yearMonthToTotalMonths(appData.idecoConfig.receiveYearMonth);
    const idecoSeveranceTotalMonths = yearMonthToTotalMonths(appData.idecoConfig.severanceYearMonth);

    const currentStocks = stocks.map((s) => ({
      meigara: s.meigara, kuchisu: s.kuchisu, tani: s.tani,
      currentValuePerUnit: s.currentValuePerUnit, averagePrice: s.averagePrice,
      annualReturn: s.annualReturn, volatility: s.volatility,
      taxStartYear: s.taxStartYear, taxStartMonth: s.taxStartMonth,
      exchangeRate: s.exchangeRate, shockBasePrice: 0.0
    }));

    let currentExchangeRates = Object.assign({}, initialRates);
    let fireFailure = false;
    let failureMonth = -1;

    const history = saveDetailHistory ? [] : null;
    const lightHistory = [];

    for (let monthIndex = 0; monthIndex < totalPeriods; monthIndex++) {
      const yearMonthStr = Math.floor(monthIndex / 12) + '年' + ((monthIndex % 12) + 1) + '月';
      jgbCouponThisMonth = 0.0;
      idecoIncomeThisMonth = 0.0;
      jgbPurchaseThisMonth = 0.0;

      const transferAssets = monthIndex === 0
        ? stocks.reduce((s, st) => s + st.kuchisu * (st.currentValuePerUnit / st.tani), 0.0)
        : (history ? history[monthIndex - 1].endOfPeriodAssets : lightHistory[monthIndex - 1].totalAsset);

      const taxRate = calculateTaxRate(monthIndex, appData.tax);

      // ---- 生活費期間の切り替え・インフレ適用 ----
      let lifeCostReset = false;
      const simCurrentYear = simStartYear + Math.floor((simStartMonth - 1 + monthIndex) / 12);
      const simCurrentMonth = ((simStartMonth - 1 + monthIndex) % 12) + 1;
      const simCurrentYearMonth = String(simCurrentYear).padStart(4, '0') + '-' + String(simCurrentMonth).padStart(2, '0');
      const simCurrentTotalMonths = simCurrentYear * 12 + simCurrentMonth;

      if (currentPeriodIndex + 1 < sortedPeriods.length) {
        const nextPeriod = sortedPeriods[currentPeriodIndex + 1];
        if (simCurrentYearMonth >= nextPeriod.appliesFromYearMonth) {
          currentPeriodIndex++;
          currentCategories = nextPeriod.categories;
          inflationRate = calculateWeightedInflationRate(currentCategories);
          currentMonthlyLifeCost = currentCategories.reduce((s, c) => s + c.monthlyAmount, 0.0);
          lifeCostReset = true;
        }
      }

      // ---- マクロ経済レジームの年次更新 ----
      // 生活費テーブルの切り替え（lifeCostReset）とは無関係に、1年ごと独立して
      // レジームを更新する（レジームは為替・生活費とは別の、市場全体のマクロ要因のため）。
      if (appData.inflationModelConfig.enabled && monthIndex > 0 && monthIndex % 12 === 0) {
        currentRegime = drawNextRegime(currentRegime);
        currentRegimeParams = effectiveRegimeParams(currentRegime, appData.inflationModelConfig.regimeIntensity);
      }

      if (monthIndex > 0 && monthIndex % 12 === 0 && !lifeCostReset) {
        let effectiveInflationRate = inflationRate;
        if (appData.inflationModelConfig.enabled) {
          effectiveInflationRate = inflationRate + currentRegimeParams.inflationDeltaPt / 100.0;
        }
        currentMonthlyLifeCost *= (1.0 + effectiveInflationRate);
      }

      // ---- iDeCo・退職金の一括受給イベント ----
      let taxPayment = 0.0;

      if (appData.idecoConfig.enabled) {
        const idc = appData.idecoConfig;

        if (!severancePaidOut && idecoSeveranceTotalMonths !== null &&
          simCurrentTotalMonths >= idecoSeveranceTotalMonths) {
          const severanceResult = FireRetirementTax.calculateSeveranceTax(idc.severanceAmount, idc.companyServiceYears);
          currentCash += severanceResult.netAmount;
          idecoIncomeThisMonth += severanceResult.netAmount;
          taxPayment += severanceResult.totalTax;
          severancePaidOut = true;
        }

        if (!idecoPaidOut && idecoReceiveTotalMonths !== null &&
          simCurrentTotalMonths >= idecoReceiveTotalMonths) {
          const idecoGrossValue = currentStocks
            .filter(isIdecoStock)
            .reduce((s, st) => s + (st.currentValuePerUnit / st.tani) * st.kuchisu, 0.0);

          if (idecoGrossValue > 0.0) {
            const idecoContributionYears = calculateIdecoContributionYears(appData, idc.startYearMonth, idc.receiveYearMonth);

            let effectiveSeveranceAmount, gapYears;
            if (severancePaidOut && idecoSeveranceTotalMonths !== null) {
              effectiveSeveranceAmount = idc.severanceAmount;
              gapYears = coerceAtLeast(Math.floor((simCurrentTotalMonths - idecoSeveranceTotalMonths) / 12), 0);
            } else {
              effectiveSeveranceAmount = 0;
              gapYears = Number.MAX_SAFE_INTEGER;
            }

            const idecoTaxResult = FireRetirementTax.calculateIdecoLumpSumTax(
              Math.round(idecoGrossValue), idecoContributionYears, effectiveSeveranceAmount, idc.companyServiceYears, gapYears);

            currentCash += idecoTaxResult.netAmount;
            idecoIncomeThisMonth += idecoTaxResult.netAmount;
            taxPayment += idecoTaxResult.totalTax;
            currentStocks.forEach((st) => { if (isIdecoStock(st)) st.kuchisu = 0; });
          }
          idecoPaidOut = true;
        }
      }

      const divResult = processDividend(monthIndex, startMonth, currentStocks, taxRate, appData);
      currentCash += divResult.gain;

      const incExp = handleIncomeAndExpense({
        monthIndex, currentCash, appData, monthlyLifeCost: currentMonthlyLifeCost, taxRate,
        currentFxRates: currentExchangeRates, simStartYear, simStartMonth
      });
      currentCash = incExp.cash;

      const tuikaResult = handleAdditionalInvestment(monthIndex, currentCash, currentStocks, appData, startMonth + 1);
      currentCash = tuikaResult.cash;

      currentStocks.forEach((stock) => {
        if (stock.meigara.endsWith('＜旧NISA＞') && stock.taxStartYear !== null && stock.taxStartMonth !== null) {
          if (stock.taxStartYear * 12 + stock.taxStartMonth === monthIndex &&
            stock.averagePrice < stock.currentValuePerUnit) {
            stock.averagePrice = stock.currentValuePerUnit;
          }
        }
      });

      // ---- 現金バッファ戦略ステートマシン処理 ----
      const currentInvestmentAssets = currentStocks.reduce(
        (s, st) => s + (st.kuchisu > 0 ? st.kuchisu * (st.currentValuePerUnit / st.tani) : 0.0), 0.0);

      if (currentInvestmentAssets > highWaterMark) highWaterMark = currentInvestmentAssets;
      const drawdownPct = highWaterMark > 0.0 ? (1.0 - currentInvestmentAssets / highWaterMark) * 100.0 : 0.0;

      cashBufferMode = updateCashBufferMode(cashBufferMode, drawdownPct, cbConfig.crashThresholdPct, cbConfig.recoveryThresholdPct);

      if (incExp.requiredAssetSale > 0.0) {
        if (cashBufferMode === 'NORMAL' || cashBufferMode === 'REFILL') {
          const saleRes = handleAssetSale(incExp.requiredAssetSale, currentCash, currentStocks, taxRate, monthIndex,
            simCurrentTotalMonths, idecoReceiveTotalMonths);
          currentCash = saleRes.cash;
          taxPayment += saleRes.tax;
          if (saleRes.failed && !fireFailure) { fireFailure = true; failureMonth = monthIndex; }
        } else {
          // CRISIS
          const cashNeeded = incExp.requiredAssetSale;
          if (cbConfig.useJgbBuffer) {
            const redeemResult = redeemJgbLotsForCash(cashNeeded, simCurrentYear, simCurrentMonth, jgbLots);
            jgbLots = redeemResult.remainingLots;
            const stillNeeded = cashNeeded - redeemResult.raised;
            if (stillNeeded <= 0.0) {
              currentCash += (-stillNeeded);
            } else {
              currentCash += redeemResult.raised;
              const saleRes = handleAssetSale(stillNeeded, 0.0, currentStocks, taxRate, monthIndex,
                simCurrentTotalMonths, idecoReceiveTotalMonths);
              currentCash += saleRes.cash;
              taxPayment += saleRes.tax;
              if (saleRes.failed && !fireFailure) { fireFailure = true; failureMonth = monthIndex; }
            }
          } else {
            if (currentCash >= cashNeeded) {
              currentCash -= cashNeeded;
            } else {
              const remainingAfterCash = cashNeeded - currentCash;
              currentCash = 0.0;
              const saleRes = handleAssetSale(remainingAfterCash, 0.0, currentStocks, taxRate, monthIndex,
                simCurrentTotalMonths, idecoReceiveTotalMonths);
              currentCash = saleRes.cash;
              taxPayment += saleRes.tax;
              if (saleRes.failed && !fireFailure) { fireFailure = true; failureMonth = monthIndex; }
            }
          }
        }
      }

      // ---- バッファ補充処理 ----
      cashBufferTarget = currentMonthlyLifeCost * 12.0 * cbConfig.cashBufferYears;

      if (cbConfig.useJgbBuffer) {
        if (simCurrentMonth === 1 || simCurrentMonth === 7) {
          let jgbCouponGross = 0.0;
          jgbLots.forEach((lot) => { jgbCouponGross += lot.faceValue * lot.quantity * lot.couponRate / 100.0 / 2.0; });
          if (jgbCouponGross > 0.0) {
            const jgbCouponTax = jgbCouponGross * taxRate;
            const jgbCouponNet = jgbCouponGross - jgbCouponTax;
            currentCash += jgbCouponNet;
            taxPayment += jgbCouponTax;
            jgbCouponThisMonth = jgbCouponNet;
          }
        }

        const jgbTotalValue = calcJgbTotalValue(jgbLots);
        const isFirstPurchase = jgbLots.length === 0;

        const currentYM = String(simCurrentYear).padStart(4, '0') + '-' + String(simCurrentMonth).padStart(2, '0');
        const jgbStartYM = cbConfig.jgbStartYearMonth || '';
        const isAfterJgbStart = jgbStartYM === '' || currentYM >= jgbStartYM;

        const effectiveMode = (cashBufferMode === 'NORMAL' && jgbTotalValue < cashBufferTarget) ? 'REFILL' : cashBufferMode;

        let shouldRefill;
        if (!isAfterJgbStart) shouldRefill = false;
        else if (effectiveMode !== 'CRISIS') shouldRefill = true;
        else if (isFirstPurchase) shouldRefill = true;
        else shouldRefill = false;

        if (shouldRefill && jgbTotalValue < cashBufferTarget - 9999.0) {
          const isRefill = effectiveMode === 'REFILL';
          const refill = refillJgbBuffer({
            cashBufferTarget, currentJgbValue: jgbTotalValue, currentStocks, taxRate, monthIndex,
            jgbCouponRate: cbConfig.jgbCouponRate, currentYear: simCurrentYear, currentMonth: simCurrentMonth,
            jgbLots, currentCash, allowAssetSale: isRefill,
            simCurrentTotalMonths, idecoReceiveTotalMonths
          });
          jgbLots = refill.updatedLots;
          currentCash = refill.remainingCash;
          jgbPurchaseThisMonth = calcJgbTotalValue(jgbLots) - jgbTotalValue;
          taxPayment += refill.saleRes.tax;
        }
      } else {
        const effectiveMode = (cashBufferMode === 'NORMAL' && currentCash < cashBufferTarget) ? 'REFILL' : cashBufferMode;
        if (effectiveMode === 'REFILL') {
          const refillResult = handleCashBufferRefill(cashBufferTarget, currentCash, currentStocks, taxRate, monthIndex,
            simCurrentTotalMonths, idecoReceiveTotalMonths);
          currentCash += refillResult.cash;
          taxPayment += refillResult.tax;
        }
      }

      const returnRes = applyMonthlyReturn(currentStocks, l, taxRate, currentExchangeRates, appData, monthIndex, saveDetailHistory, currentRegimeParams);
      currentExchangeRates = Object.assign({}, returnRes.nextExchangeRates);

      // ---- ストレステスト: インデックス修正法（Phantom Index Method）----
      if (shockRateFn) {
        const shockRate = shockRateFn(monthIndex);
        const prevShockRate = monthIndex > 0 ? shockRateFn(monthIndex - 1) : 0.0;
        const isShockStart = shockRate !== 0.0 && prevShockRate === 0.0;

        if (isShockStart) {
          currentStocks.forEach((s) => {
            if (s.kuchisu > 0) {
              s.shockBasePrice = s.currentValuePerUnit;
              s.currentValuePerUnit = s.shockBasePrice * (1.0 + shockRate);
            }
          });
        } else if (shockRate !== 0.0) {
          currentStocks.forEach((s) => {
            if (s.kuchisu > 0 && s.shockBasePrice > 0.0) {
              const prevActualPrice = s.shockBasePrice * (1.0 + prevShockRate);
              const monthlyReturnMult = prevActualPrice > 0.0 ? s.currentValuePerUnit / prevActualPrice : 1.0;
              s.shockBasePrice *= monthlyReturnMult;
              s.currentValuePerUnit = s.shockBasePrice * (1.0 + shockRate);
            }
          });
        } else {
          currentStocks.forEach((s) => { s.shockBasePrice = 0.0; });
        }
      }

      const endAssets = shockRateFn
        ? currentStocks.reduce((s, st) => s + (st.kuchisu > 0 ? st.kuchisu * (st.currentValuePerUnit / st.tani) : 0.0), 0.0)
        : returnRes.endOfPeriodAssets;

      const jgbBufferValueThisMonth = calcJgbTotalValue(jgbLots);
      const totalAsset = endAssets + currentCash + jgbBufferValueThisMonth;
      if (totalAsset < 0.0 && !fireFailure) { fireFailure = true; failureMonth = monthIndex; }

      const recTotalAsset = (fireFailure && failureMonth <= monthIndex) ? 0.0 : totalAsset;
      const recCash = (fireFailure && failureMonth < monthIndex) ? 0.0 : currentCash;
      const recInvestmentAssets = (fireFailure && failureMonth < monthIndex) ? 0.0 : endAssets;

      // monthlyLifeCost：この月時点の月次生活費（インフレ／デフレ適用後）。
      // 「月の生活費」テーブル（生活費の分布・破綻件数の集計）で全試行分を参照するために保持する
      lightHistory.push({
        totalAsset: recTotalAsset, cash: recCash, isFailure: fireFailure,
        investmentAssets: recInvestmentAssets, monthlyLifeCost: currentMonthlyLifeCost
      });

      if (history) {
        const recStockDetails = (fireFailure && failureMonth < monthIndex)
          ? returnRes.stockDetails.map((d) => Object.assign({}, d, { value: 0.0, kuchisu: 0 }))
          : returnRes.stockDetails;

        // 保有債券タブ（appData.bonds）の各銘柄について、この月時点で
        // 満期を迎えている（＝償還済み）かどうかを、実際の満期判定と同じ
        // 「絶対年月の比較」で判定し、月次内訳ポップアップ表示用に記録する。
        // 個人向け国債は日々値洗いする資産ではなく、額面固定・満期償還の商品として
        // 扱っているため、ここでは時価ではなく「保有中／満期償還済み」の状態を残す。
        const recBondStatuses = appData.bonds.map((bond) => {
          const maturityParts = bond.maturityYM.split('-');
          const maturityYear = parseInt(maturityParts[0], 10) || 0;
          const maturityMonth = parseInt(maturityParts[1], 10) || 0;
          const isMatured = (maturityYear < simCurrentYear) || (maturityYear === simCurrentYear && maturityMonth <= simCurrentMonth);
          return {
            name: bond.name, faceValue: bond.faceValue, quantity: bond.quantity,
            couponRate: bond.couponRate, maturityYM: bond.maturityYM, currency: bond.currency,
            isMatured
          };
        });

        history.push({
          yearMonth: yearMonthStr, transferAssets, expense: incExp.totalExpense,
          income: incExp.monthlyIncome + divResult.gain + jgbCouponThisMonth,
          gain: divResult.gain, tax: taxPayment + divResult.gainTax, gainTax: divResult.gainTax,
          cash: recCash, tuika: tuikaResult.totalInvestment,
          endOfPeriodAssets: (fireFailure && failureMonth < monthIndex) ? 0.0 : endAssets,
          totalAsset: recTotalAsset, stockDetails: recStockDetails, fxRates: Object.assign({}, currentExchangeRates),
          isFailure: fireFailure,
          jgbBufferValue: jgbBufferValueThisMonth, jgbBufferLotCount: jgbLots.reduce((s, lo) => s + lo.quantity, 0),
          jgbCouponThisMonth, idecoIncomeThisMonth, jgbPurchaseThisMonth,
          bondStatuses: recBondStatuses,
          // その月時点の月次生活費（大きな出費・インフレ適用後）。年間生活費の資産比率グラフ等で使用する
          monthlyLifeCost: currentMonthlyLifeCost
        });
      }
    }

    return {
      trialId, success: !fireFailure, failureMonth: fireFailure ? failureMonth : totalPeriods,
      history: history || [], lightHistory
    };
  }

  // =====================================================
  // メインシミュレーション実行
  // =====================================================

  /**
   * モンテカルロシミュレーションのエントリポイント。
   * appData.config.times回分の試行を実行し、各試行の結果をリストで返す。
   * @param {function} onProgress 進捗コールバック (現在の試行数, 総試行数)
   */
  function runSimulation(appData, onProgress) {
    onProgress = onProgress || function () {};
    const stocks = appData.stocks;
    if (stocks.length === 0) return [];

    const l = buildCholeskyMatrix(appData);
    const initialRates = buildInitialRates(appData);
    const startMonth = new Date().getMonth(); // 0-11

    const numTrials = appData.config.times;
    const failureDetailLimit = coerceIn(appData.config.failureDetailLimit, 0, 200);

    let failureDetailCount = 0;
    const results = [];

    for (let t = 1; t <= numTrials; t++) {
      onProgress(t, numTrials);
      const result = runOneTrial(t, appData, l, initialRates, startMonth, true, null);

      const keepDetail = t === 1 || (!result.success && failureDetailCount < failureDetailLimit);
      if (!result.success && failureDetailCount < failureDetailLimit) failureDetailCount++;

      results.push(keepDetail ? result : Object.assign({}, result, { history: [] }));
    }

    return results;
  }

  /**
   * モンテカルロシミュレーションを、ブラウザのUIスレッドをブロックしないよう
   * 少数の試行ずつ小分け（チャンク）に実行する版。
   *
   * runSimulation()は全試行を1回のJS呼び出しの中で同期的に回しきってしまうため、
   * 進捗コールバック（onProgress）を呼んでいても、ブラウザが実際に画面を
   * 再描画する機会がなく、進捗バーが「実行中→いきなり完了」のように見えてしまう
   * （JSの呼び出しスタックが空になるまで、DOMへの変更は画面に反映されないため）。
   * この関数は、一定件数（チャンク）ごとに setTimeout(...,0) で処理を区切り、
   * その都度いったんブラウザに制御を返すことで、チャンクの合間に画面が
   * 再描画され、進捗バー・件数表示が実際に更新されていくようにする。
   *
   * @param {Object} appData 前処理済みのAppData
   * @param {function} onProgress 進捗コールバック (現在の試行数, 総試行数)
   * @param {function} onComplete 完了コールバック (results配列)
   * @param {number} [chunkSize] 1チャンクあたりの試行数。省略時は、試行回数に
   *   応じて「進捗更新がおおよそ100回程度になる」件数を自動計算する
   *   （試行回数が多いときに、チャンクの数＝setTimeoutの呼び出し回数が
   *   増えすぎて、逆に全体の完了が遅くなるのを防ぐため）。
   */
  function runSimulationChunked(appData, onProgress, onComplete, chunkSize) {
    onProgress = onProgress || function () {};
    onComplete = onComplete || function () {};

    const stocks = appData.stocks;
    if (stocks.length === 0) { onComplete([]); return; }

    const l = buildCholeskyMatrix(appData);
    const initialRates = buildInitialRates(appData);
    const startMonth = new Date().getMonth();

    const numTrials = appData.config.times;
    const failureDetailLimit = coerceIn(appData.config.failureDetailLimit, 0, 200);
    const effectiveChunkSize = chunkSize || Math.max(1, Math.ceil(numTrials / 100));

    let failureDetailCount = 0;
    const results = [];
    let t = 1;

    /** 1チャンク分（最大 effectiveChunkSize 件）の試行を実行し、続きがあれば次のチャンクをスケジュールする */
    function runNextChunk() {
      const chunkEndTrial = Math.min(t + effectiveChunkSize - 1, numTrials);
      for (; t <= chunkEndTrial; t++) {
        const result = runOneTrial(t, appData, l, initialRates, startMonth, true, null);

        const keepDetail = t === 1 || (!result.success && failureDetailCount < failureDetailLimit);
        if (!result.success && failureDetailCount < failureDetailLimit) failureDetailCount++;

        results.push(keepDetail ? result : Object.assign({}, result, { history: [] }));
        onProgress(t, numTrials);
      }

      if (t <= numTrials) {
        setTimeout(runNextChunk, 0);
      } else {
        onComplete(results);
      }
    }

    runNextChunk();
  }

  /**
   * ストレステスト用シミュレーション。通常のモンテカルロ変動に加えて、
   * shockConfigで指定した月に一時的な株価ショック（暴落）を発生させ、
   * recoveryMonthsかけて線形に回復させながらシミュレーションを実行する。
   */
  function runSimulationWithShock(appData, shockConfig, onProgress) {
    onProgress = onProgress || function () {};
    if (appData.stocks.length === 0) return [];

    const l = buildCholeskyMatrix(appData);
    const initialRates = buildInitialRates(appData);
    const startMonth = new Date().getMonth();

    const shockFn = (monthIndex) => {
      const sm = shockConfig.shockMonth;
      const rm = shockConfig.recoveryMonths;
      if (monthIndex < sm) return 0.0;
      if (monthIndex === sm) return shockConfig.shockMagnitude;
      if (monthIndex < sm + rm) return shockConfig.shockMagnitude * (1.0 - (monthIndex - sm) / rm);
      return 0.0;
    };

    const numTrials = appData.config.times;
    const failureDetailLimit = coerceIn(appData.config.failureDetailLimit, 0, 200);
    let failureDetailCount = 0;
    const results = [];

    for (let t = 1; t <= numTrials; t++) {
      onProgress(t, numTrials);
      const result = runOneTrial(t, appData, l, initialRates, startMonth, true, shockFn);
      const keepDetail = !result.success && failureDetailCount < failureDetailLimit;
      if (!result.success && keepDetail) failureDetailCount++;
      results.push(keepDetail ? result : Object.assign({}, result, { history: [] }));
    }

    return results;
  }

  // =====================================================
  // サマリー計算
  // =====================================================

  /** 数値リストの p パーセンタイル値を線形補間で計算する（p は0〜100） */
  function percentile(data, p) {
    if (data.length === 0) return 0.0;
    const sorted = data.slice().sort((a, b) => a - b);
    const index = (p / 100.0) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1.0 - (index - lower)) + sorted[upper] * (index - lower);
  }

  /**
   * 全試行のシミュレーション結果からサマリー統計を算出する。
   * 成功率、成功試行の最終資産額（中央値・P10・P90）を計算する。
   */
  function calculateSummary(results, failureDetailLimit) {
    failureDetailLimit = failureDetailLimit === undefined ? 50 : failureDetailLimit;
    if (results.length === 0) {
      return { totalTrials: 0, successCount: 0, failureCount: 0, successRate: 0.0, medianSuccessAsset: 0.0, worst10thAsset: 0.0, medianFailureMonth: 0.0, medianFailureAsset: 0.0, failureDetailLimit };
    }

    const successCount = results.filter((r) => r.success).length;
    const successRate = successCount / results.length * 100.0;

    const successFinals = results.filter((r) => r.success)
      .map((r) => (r.lightHistory.length > 0 ? r.lightHistory[r.lightHistory.length - 1].totalAsset : null))
      .filter((v) => v !== null);
    const failMonths = results.filter((r) => !r.success).map((r) => r.failureMonth + 1);
    const failFinals = results.filter((r) => !r.success)
      .map((r) => (r.lightHistory.length > 0 ? r.lightHistory[r.lightHistory.length - 1].totalAsset : null))
      .filter((v) => v !== null);

    return {
      totalTrials: results.length,
      successCount,
      failureCount: results.length - successCount,
      successRate,
      medianSuccessAsset: percentile(successFinals, 50.0),
      worst10thAsset: percentile(successFinals, 10.0),
      medianFailureMonth: percentile(failMonths, 50.0),
      medianFailureAsset: percentile(failFinals, 50.0),
      failureDetailLimit
    };
  }

  /**
   * 全試行の lightHistory から月次パーセンタイルを計算して返す（ファンチャート用）。
   * @param step グラフ解像度（月）。デフォルト6（半年ごと）
   */
  function calculatePercentileTimeline(results, step) {
    step = step || 6;
    if (results.length === 0) return [];
    const totalMonths = results[0].lightHistory.length;
    if (totalMonths <= 0) return [];

    const indices = [];
    for (let m = 0; m < totalMonths; m += step) indices.push(m);
    if (indices.length === 0 || indices[indices.length - 1] < totalMonths - 1) indices.push(totalMonths - 1);

    return indices.map((m) => {
      const assets = results.map((r) => (r.lightHistory[m] ? r.lightHistory[m].totalAsset : null)).filter((v) => v !== null);
      return {
        monthIndex: m,
        p10: percentile(assets, 10.0), p25: percentile(assets, 25.0), p50: percentile(assets, 50.0),
        p75: percentile(assets, 75.0), p90: percentile(assets, 90.0)
      };
    });
  }

  // 生活費テーブルの列定義：生活費が多い順に並べたときの「上位何％」の層を表示するか。
  // パーセンタイル方式（percentile関数は昇順基準のため、上位P%は (100 - P) 昇順パーセンタイルに対応する）
  const LIFE_COST_TABLE_TIERS = [
    { label: '上位1%', upperPercent: 1 },
    { label: '上位20%', upperPercent: 20 },
    { label: '上位40%', upperPercent: 40 },
    { label: '中央値(50%)', upperPercent: 50 },
    { label: '上位70%', upperPercent: 70 },
    { label: '上位90%', upperPercent: 90 },
    { label: '下位(100%)', upperPercent: 100 }
  ];

  /**
   * 破綻ケース1件分の「固定された生活費水準」を求める。
   * 破綻後もインフレ計算自体は継続してしまい生活費の数値が増え続けてしまうため、
   * 「破綻した瞬間（failureMonth時点）の生活費」を、そのケースの生活水準として固定して使う。
   */
  function getFrozenLifeCostAtFailure(result) {
    const failureRecord = result.lightHistory[result.failureMonth];
    return failureRecord ? failureRecord.monthlyLifeCost : null;
  }

  /**
   * 破綻ケースの固定生活費（B）を、その年の生存者ベースの層のしきい値（高い順の配列）に当てはめて、
   * どの層に属するかを求める。tierValuesDescendingは「上位1%・20%・40%・50%・70%・90%・下位100%」の順
   * （値は非増加）で並んでいる前提で、Bが「そのしきい値以上」となる最初の層に分類する
   * （＝その層の代表値以上の生活費だった、という意味）。
   * 生存者がおらずしきい値が1つも求まらない場合はnullを返す（呼び出し側で別扱いする）。
   */
  function classifyFrozenCostIntoTier(cost, tierValuesDescending) {
    for (let i = 0; i < tierValuesDescending.length; i++) {
      if (tierValuesDescending[i] !== null && cost >= tierValuesDescending[i]) return i;
    }
    // どのしきい値にも届かない場合は、生存者がいれば最下層（下位100%）に分類する
    return tierValuesDescending.some((v) => v !== null) ? tierValuesDescending.length - 1 : null;
  }

  /**
   * 指定した年（monthIndex時点）における、生存中の全試行の月次生活費を
   * 「多い順」に並べたときの各層（上位1%・20%・40%・50%・70%・90%・100%）の金額と、
   * 「この年の期間内（prevMonthIndexより後、monthIndex以下）に新たに破綻したケース」が
   * どの層に相当する生活水準だったかを計算する。累計ではなく、この期間内に発生した
   * 破綻のみを対象とする（＝生活費が高い層ほど、この期間中の破綻が多いのかを見るための集計）。
   * 各層には、該当する破綻ケースの試行番号（trialId）の一覧を保持する。
   */
  function calculateLifeCostSnapshot(results, monthIndex, prevMonthIndex) {
    const survivorLifeCosts = [];
    results.forEach((r) => {
      const record = r.lightHistory[monthIndex];
      if (record && !record.isFailure) survivorLifeCosts.push(record.monthlyLifeCost);
    });

    // 「上位P%」＝多い方から数えてP%目 ＝ 昇順パーセンタイルでは (100-P)%地点にあたる
    const tierValues = LIFE_COST_TABLE_TIERS.map((tier) =>
      survivorLifeCosts.length > 0 ? percentile(survivorLifeCosts, 100 - tier.upperPercent) : null
    );

    const failedTrialIdsByTier = LIFE_COST_TABLE_TIERS.map(() => []);
    results.forEach((r) => {
      if (r.success) return;
      // 「その年層で発生した」破綻のみを対象とする（前回の基準年より後、今回の基準年まで）
      if (r.failureMonth <= prevMonthIndex || r.failureMonth > monthIndex) return;
      const frozenCost = getFrozenLifeCostAtFailure(r);
      if (frozenCost === null) return;
      const binIndex = classifyFrozenCostIntoTier(frozenCost, tierValues);
      if (binIndex !== null) failedTrialIdsByTier[binIndex].push(r.trialId);
    });

    const tiers = LIFE_COST_TABLE_TIERS.map((tier, i) => ({
      label: tier.label,
      value: tierValues[i],
      failedTrialIds: failedTrialIdsByTier[i]
    }));

    return { monthIndex, tiers, survivorCount: survivorLifeCosts.length, totalTrials: results.length };
  }

  /**
   * 「月の生活費」テーブル（縦軸＝年、横軸＝生活費の多い順の層）用のデータを、
   * 資産推移グラフより先に表示するため、指定した年間隔（デフォルト5年）ごとに算出する。
   * @param results runSimulation等の戻り値（全試行分）
   * @param intervalYears 何年おきに集計するか（デフォルト5年）
   */
  function calculateLifeCostTable(results, intervalYears) {
    intervalYears = intervalYears || 5;
    if (results.length === 0) return [];
    const totalMonths = results[0].lightHistory.length;
    if (totalMonths <= 0) return [];

    const maxYear = Math.floor((totalMonths - 1) / 12);
    const rows = [];
    for (let year = intervalYears; year <= maxYear; year += intervalYears) {
      const monthIndex = year * 12;
      const prevMonthIndex = (year - intervalYears) * 12;
      rows.push(Object.assign({ year }, calculateLifeCostSnapshot(results, monthIndex, prevMonthIndex)));
    }
    return rows;
  }

  // =====================================================
  // 公開API
  // =====================================================
  global.FireEngine = {
    runSimulation, runSimulationChunked, runSimulationWithShock, calculateSummary, calculatePercentileTimeline,
    calculateLifeCostTable,
    percentile, calculateTaxRate, yearMonthToTotalMonths,
    // テスト・デバッグ用に内部関数の一部も公開する
    // getBaseName: 相関係数タブ（ui-tabs.js）が、保有銘柄一覧からベース銘柄名
    // （＜口座種別＞を除いた部分）を重複排除して選択肢を作るために使う
    _internal: {
      matCholesky, matDot, matIdentity, buildCholeskyMatrix, saleOrder, calcUnitNet, getBaseName,
      // テスト用: マクロ経済レジームモデル関連
      drawNextRegime, effectiveRegimeParams, REGIME_TRANSITION_MATRIX, REGIME_BASE_PARAMS, REGIME_NAMES
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
