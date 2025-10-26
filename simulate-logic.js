/* numeric.jsを抱き込む */
const numeric = {
    rep: (row, col, value = 0) => {
        const matrix = [];
        for (let i = 0; i < row; i++) {
            matrix.push(new Array(col).fill(value));
        }
        return matrix;
    },
    dot: (A, B) => {
        if (A[0].length !== B.length) {
            console.error("行列の次元が一致しません");
            return numeric.rep(A.length, B[0].length, 0);
        }
        const result = numeric.rep(A.length, B[0].length);
        for (let i = 0; i < A.length; i++) {
            for (let j = 0; j < B[0].length; j++) {
                let sum = 0;
                for (let k = 0; k < A[0].length; k++) {
                    sum += A[i][k] * B[k][j];
                }
                result[i][j] = sum;
            }
        }
        return result;
    },
    identity: (n) => {
        const matrix = numeric.rep(n, n);
        for (let i = 0; i < n; i++) {
            matrix[i][i] = 1;
        }
        return matrix;
    },
    cholesky: (R) => {
        const n = R.length;
        const L = numeric.rep(n, n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                if (i === j) {
                    let sum = 0;
                    for (let k = 0; k < j; k++) {
                        sum += L[j][k] * L[j][k];
                    }
                    const diagVal = R[i][i] - sum;
                    if (diagVal < 0) {
                        throw new Error(`コレスキー分解エラー: 負の対角要素 (${diagVal.toFixed(4)})`);
                    }
                    L[i][j] = Math.sqrt(diagVal);
                } else {
                    let sum = 0;
                    for (let k = 0; k < j; k++) {
                        sum += L[i][k] * L[j][k];
                    }
                    if (L[j][j] === 0) {
                        L[i][j] = 0;
                    } else {
                        L[i][j] = (R[i][j] - sum) / L[j][j];
                    }
                }
            }
        }
        return L;
    },
    transpose: (M) => {
        const rows = M.length;
        const cols = M[0].length;
        const result = numeric.rep(cols, rows);
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                result[j][i] = M[i][j];
            }
        }
        return result;
    },
    random: {
        normal: (mu = 0, sigma = 1) => {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            let mag = sigma * Math.sqrt(-2.0 * Math.log(u));
            return mag * Math.cos(2.0 * Math.PI * v) + mu;
        }
    }
};
// --- numeric.js 終了 ---


/******************* モンテカルロ・シミュレーション用の関数 ***************************************/
/**
 * 月次税率を決定する
 * @param {number} monthIndex - 現在の経過月数
 * @param {object} taxEvents - 税金関係の設定
 */
function calculateTaxRate(monthIndex, taxEvents) {
    let rate = 0.20315; // デフォルト 20.315%
    const taxRateEvent = taxEvents.slice().reverse().find(t => monthIndex >= t.month);
    if (taxRateEvent) {
        rate = taxRateEvent.rate / 100;
    }
    return rate;
}

/**
 * 収入と出費を処理し、現金残高を更新し、不足額を返す
 * @param {number} monthIndex - 現在の経過月数
 * @param {number} currentCash - 現在の保有現金
 * @param {object} appData - アプリケーションデータ
 * @param {number} currentMonthlyLifeCost - インフレ適用済みの現在の月次生活費
 */
function handleIncomeAndExpense(monthIndex, currentCash, appData, currentMonthlyLifeCost) {
    const { bigExpense, income } = appData;

    /**** 1. 収入を、保有現金に加算する(収入処理を最優先で実施するものとする。) ****/
    const incomeEvent = income.filter(inc =>
        monthIndex >= inc.startTotalMonths &&
        (inc.endTotalMonths === null || inc.endTotalMonths === undefined || monthIndex <= inc.endTotalMonths)
    );
    let monthlyIncome = 0;
    incomeEvent.forEach(inc => {
        monthlyIncome += inc.amount
    });
    currentCash += monthlyIncome;

    /**** 2. 出費額を求める ****/
    //2.1 インフレを適用した生活費を出費のベースとする。
    const baseLifeCost = currentMonthlyLifeCost;

    //2.2 対象月に該当する大口出費の総額を求める。
    let bigExpenseAmount = 0;
    const bigExpenseEvent = bigExpense.filter(be => be.month === monthIndex);
    bigExpenseEvent.forEach(be => {
        bigExpenseAmount += be.amount;
    });

    // 月次総出費（生活費＋大口出費）(表示用/計算用)
    const monthlyTotalExpense = baseLifeCost + bigExpenseAmount;

    /**** 3. 保有現金から出費額を引く ****/
    let requiredAssetSale = 0; // 不足額（資産売却が必要な額）
    let cashBalance = currentCash;
    if (cashBalance >= monthlyTotalExpense) {
        //保有現金で月の出費を賄える場合
        cashBalance -= monthlyTotalExpense;
    } else {
        //保有現金で月の出費を賄いきれない場合
        requiredAssetSale = monthlyTotalExpense - cashBalance; // 不足額
        cashBalance = 0;
    }

    return {
        currentCash: cashBalance,
        monthlyIncome: monthlyIncome,
        totalExpense: monthlyTotalExpense, // (3) 出費表示用は、シンプルに月次総出費を返す
        requiredAssetSale: requiredAssetSale // 不足額
    };
}

/**
 * 追加投資を処理し、保有口数と平均取得価額を更新する
 * 注意：保有現金が足りないときは追加投資をしない。
 */
function handleTuikaInvestment(monthIndex, currentCash, currentStocks, appData, meigaraNames) {
    /* 条件を満たす追加投資データの抽出 */
    let tuikaEvents = [];
    for (const tui of appData.tuika) {
        //対象外を外す
        //対象の期間ではないとき対象外とする
        if (tui.month > monthIndex || tui.toMonth_totalMonths < monthIndex) {
            continue;
        }
        //パターンごとの処理。処理回数が多いもの順
        //各月なら対象。期間チェックはすでに済んでいるので省略
        if (tui.pattern === "各月") {
            tuikaEvents.push(tui);
            continue;
        }
        //１回かつ対象月なら対象
        if (tui.pattern === "１回") {
            //対象月でなければ対象外
            if (tui.month !== monthIndex) {
                continue;
            }
            tuikaEvents.push(tui);
            continue;
        }
        //各年のパターン
        //シミュレーション上の年月　から　追加投資開始年月の年月を引いて、１２で割り切れれば対象年月となる
        const w = monthIndex - tui.month;
        //１２で割り切れないときは対象外
        if (w % 12 === 0) {
            tuikaEvents.push(tui);
        }
    }

    /* 抽出した追加投資情報に基づいて、追加投資を行う */
    let monthlyTuikaInvestment = 0;
    for (const tuika of tuikaEvents) {
        const targetStockIndex = meigaraNames.indexOf(tuika.meigara);
        if (targetStockIndex === -1) continue;

        const targetStock = currentStocks[targetStockIndex];
        const investmentAmount = tuika.amount;

        //追加投資失敗: 現金不足。
        if (currentCash < investmentAmount) {
            continue;
        }

        currentCash -= investmentAmount;
        monthlyTuikaInvestment += investmentAmount;

        const pricePerUnit = targetStock.CurrentValuePerUnit / targetStock.Tani;
        if (pricePerUnit <= 0) continue;

        const boughtKuchisu = Math.floor(investmentAmount / pricePerUnit);

        const oldTotalValue = targetStock.Kuchisu * (targetStock.AveragePrice / targetStock.Tani);
        const newTotalValue = oldTotalValue + investmentAmount;
        const newTotalKuchisu = targetStock.Kuchisu + boughtKuchisu;

        targetStock.Kuchisu = newTotalKuchisu;

        if (newTotalKuchisu > 0) {
            const newAveragePricePerUnit = newTotalValue / newTotalKuchisu;
            targetStock.AveragePrice = newAveragePricePerUnit * targetStock.Tani;
        }
    }

    return { currentCash, monthlyTuikaInvestment };
}


/**
 * 金融資産を売却する (課税銘柄優先ロジックを実装し、Taniを考慮)
 * 注意: この関数は、引数で渡された currentStocks リストの要素（銘柄オブジェクト）の 
 * Kuchisu (口数) プロパティを直接変更します。
 * * 戻り値: { currentCash: number, taxPayment: number, sellProceeds: number, fireFailure: boolean }
 * * fireFailure: true = 破綻 (不足額を賄いきれず), false = 破綻せず (賄えた)
 * @param {number} requiredExpense - 売却で賄うべき金額（マイナスになった保有現金の絶対値）。
 * @param {number} currentCash - 現在の保有現金（売却直前の現金残高）。
 * @param {array} currentStocks - 現在保有している銘柄のリスト
 * @param {number} trialCurrentTaxRate - 当月の税率（小数）
 * @param {number} monthIndex - 現在の経過月数
 * @returns {object} { currentCash: number, taxPayment: number, sellProceeds: number, fireFailure: boolean }
 */
function handleAssetSale(requiredExpense, currentCash, currentStocks, trialCurrentTaxRate, monthIndex) {
// ----------------------------------------------------
    // 0. 初期チェック
    // ----------------------------------------------------
    // stocks は引数の currentStocks を直接指します (参照)。
    const stocks = Array.isArray(currentStocks) ? currentStocks : [];

    //最終的に売却が必要な金額を求める。
    let neededAmount = requiredExpense;

    // 最初のreturn: 不足額が0以下の場合、売却は不要。
    if (neededAmount <= 0) {
        return { 
            currentCash: Math.floor(currentCash), // 現金は切り捨て
            taxPayment: 0, 
            sellProceeds: 0, 
            fireFailure: false
        };
    }
    //持っている保有現金をあてて、最終的に売却が必要な金額を求める。
    neededAmount = requiredExpense - currentCash;
    //保有現金は全部生活費にあてたので、なくなった
    currentCash = 0;

    // 総資産額計算 (破綻判定用)　総資産額が、必要な出費額に達していないときは破綻確定
    let totalAssetValue = stocks.reduce((sum, stock) => {
        const valuePerKuchisu = (stock.CurrentValuePerUnit / stock.Tani); 
        return sum + valuePerKuchisu * stock.Kuchisu;
    }, 0);
    
    // 2番目のreturn: 銘柄がない、または総資産が不足額に満たない場合は破綻。
    if (stocks.length === 0 || totalAssetValue < neededAmount) {
          return { 
            currentCash: Math.floor(currentCash), // 現金はそのまま、切り捨て
            taxPayment: 0, 
            sellProceeds: 0, 
            fireFailure: true
        };
    }

    let remainingNeededAmount = neededAmount;
    let totalSalesAmount = 0;
    let totalTax = 0;
    
    // ----------------------------------------------------
    // 1. 課税・非課税銘柄の分類
    // ----------------------------------------------------
    const { taxableStocks, nonTaxableStocks } = stocks.reduce((acc, stock) => {
        // TaxStartYearがnullでない、かつ、設定された年月がシミュレーション中の年月以下である場合に課税
        const isTaxable = !(stock.TaxStartYear === null || 
                            (stock.TaxStartYear * 12 + stock.TaxStartMonth > monthIndex));
        
        // 配列には stocks (currentStocks) の要素への参照が入ります
        if (isTaxable) {
            acc.taxableStocks.push(stock);
        } else {
            acc.nonTaxableStocks.push(stock);
        }
        return acc;
    }, { taxableStocks: [], nonTaxableStocks: [] });

    // ====================================================
    // 2. 課税銘柄の売却処理 (優先)
    //    - 1口あたりの税引後受取額を算出し、それから必要な口数を求める
    // ====================================================
    for (const stock of taxableStocks) {
        if (remainingNeededAmount <= 0) break;

        // 1口あたりの現在価値（売却単価）は小数点以下切り捨て
        const unitSalePrice = Math.floor(stock.CurrentValuePerUnit / stock.Tani);
        // 1口あたりの平均取得価額（原価）は小数点以下切り上げ
        const unitAveragePrice = Math.ceil(stock.AveragePrice / stock.Tani);

        // 価額0または保有0のときは売れないので次の銘柄へ
        if (unitSalePrice <= 0 || stock.Kuchisu <= 0) continue;

        // 税金計算: 1口あたりの利益と税金、税引後受取額を計算
        const unitGain = unitSalePrice - unitAveragePrice;
        // 利益が出ている場合のみ課税
        const unitTaxPerUnit = unitGain > 0 ? unitGain * trialCurrentTaxRate : 0;
        // 1口あたりの税引後受取額
        const unitNetProceeds = unitSalePrice - unitTaxPerUnit;
        
        // 売却目標口数の決定 (税引後の金額でremainingNeededAmountを賄うのに必要な口数)
        let targetKuchisu;
        
        if (unitNetProceeds > 0) {
            // 税引後受取額が正の場合: 必要な金額を賄うのに必要な口数を正確に計算
            targetKuchisu = Math.ceil(remainingNeededAmount / unitNetProceeds);
        } else {
             // 税引後受取額が0以下の場合: 
             // 全て売却しても不足額を賄いきれない（税引後で）が、破綻回避のため、この銘柄をすべて売却する
             targetKuchisu = stock.Kuchisu;
        }

        // 実際に売却する口数: 目標口数と保有口数の少ない方
        const actualSaleKuchisu = Math.min(targetKuchisu, stock.Kuchisu);

        if (actualSaleKuchisu <= 0) continue; 
        
        // 実際の売却詳細を計算
        const actualSaleGrossAmount = actualSaleKuchisu * unitSalePrice;
        let actualTax = 0;
        if (unitGain > 0) { 
            // 実際の売却口数に基づくトータルの利益
            const actualGain = actualSaleKuchisu * unitGain;
            actualTax = actualGain * trialCurrentTaxRate;
        }
        
        const sellProceedsAfterTax = actualSaleGrossAmount - actualTax;

        // remainingNeededAmount の更新
        remainingNeededAmount -= sellProceedsAfterTax;
        
        // 口数減算処理: currentStocks の要素を直接更新
        stock.Kuchisu -= actualSaleKuchisu;
        // 売却した金額の合計
        totalSalesAmount += actualSaleGrossAmount;
        // 支払った税金の合計
        totalTax += actualTax;
    }
    
    // ----------------------------------------------------
    // 3. 非課税銘柄の売却処理
    // ----------------------------------------------------
    for (const stock of nonTaxableStocks) {
        if (remainingNeededAmount <= 0) break;

        const unitSalePrice = Math.floor(stock.CurrentValuePerUnit / stock.Tani);
        if (unitSalePrice <= 0 || stock.Kuchisu <= 0) continue; 
        
        // 最小売却口数を決定
        let targetKuchisu = (remainingNeededAmount <= unitSalePrice) 
                            ? 1 
                            : Math.ceil(remainingNeededAmount / unitSalePrice);
        
        const actualSaleKuchisu = Math.min(targetKuchisu, stock.Kuchisu);
        
        if (actualSaleKuchisu <= 0) continue; 
        
        const actualSaleAmount = actualSaleKuchisu * unitSalePrice;
        
        const sellProceedsAfterTax = actualSaleAmount; // 非課税なので税金は0

        // remainingNeededAmount の更新
        if (sellProceedsAfterTax >= remainingNeededAmount) {
            remainingNeededAmount = 0;
        } else {
            remainingNeededAmount -= sellProceedsAfterTax;
        }
        
        //口数減算処理: currentStocks の要素を直接更新
        stock.Kuchisu -= actualSaleKuchisu;
        
        totalSalesAmount += actualSaleAmount;
    }
    
    // ----------------------------------------------------
    // 4. 破綻判定と戻り値の作成
    // ----------------------------------------------------
    const isRuined = remainingNeededAmount > 0;
    
    let finalCash;
    
    if (isRuined) {
        // 破綻した場合: 現金はマイナスにせず0
        finalCash = 0; 
    } else {
        // 破綻しなかった場合: currentCash (売却前) + 売却で得た現金 (税引後) - 元の出費
        finalCash = currentCash + totalSalesAmount - totalTax - neededAmount;
    }
    
    // 最終保有現金を小数点以下切り捨て
    const roundedFinalCash = Math.floor(finalCash);

    return {
        currentCash: roundedFinalCash,      // 不足していた出費も支払った後の最終現金残高 (切り捨て)
        taxPayment: totalTax,               // 支払う税金総額
        sellProceeds: totalSalesAmount,     // 売却で得た総額
        fireFailure: isRuined               // 破綻 (true) / 破綻せず (false)
    };
}

/**
 * 銘柄の利率変動を適用し、月末の資産額と詳細を計算する
 */
function applyMonthlyReturn(monthIndex, currentStocks, L, trialCurrentTaxRate) {
    const numStocks = currentStocks.length;
    const standardNormals = Array(numStocks).fill(0).map(() => numeric.random.normal());
    const Y = numeric.dot(L, standardNormals.map(n => [n]));
    const stockDetails = [];
    let endOfPeriodAssets = 0;

    for (let i = 0; i < numStocks; i++) {
        const stock = currentStocks[i];

        if (stock.Kuchisu <= 0) {
            stockDetails.push({ rate: 0, value: 0, kuchisu: 0, currentValuePerUnit: 0, averagePrice: stock.AveragePrice, taxPerUnit: 0 });
            continue;
        }

        // 利率変動計算
        const monthlyVolatility = stock.Volatility / 100 / Math.sqrt(12);
        const monthlyReturn = stock.Return / 100 / 12;
        const correlatedZ = Y[i][0];

        //その月のその銘柄に適用する、利率を計算する
        const monthlyRate = Math.exp(
            (monthlyReturn - monthlyVolatility * monthlyVolatility / 2) +
            (monthlyVolatility * correlatedZ)
        ) - 1;

        // 単位口数当たりの新しい価額に更新
        stock.CurrentValuePerUnit *= (1 + monthlyRate);

        // 新しい金融資産額
        const currentValuePerUnit = stock.CurrentValuePerUnit;
        const pricePerUnit = currentValuePerUnit / stock.Tani;
        const financialAssetValue = stock.Kuchisu * pricePerUnit;
        endOfPeriodAssets += financialAssetValue;

        // 表示用税額の計算
        let taxPerUnit = 0;
        const taxStartMonthIndex = stock.TaxStartYear * 12 + (stock.TaxStartMonth === 0 ? 0 : stock.TaxStartMonth - 1);
        const isTaxable = (stock.TaxStartYear === null || stock.TaxStartMonth === null) ? false :
            ((stock.TaxStartYear === 0 && (stock.TaxStartMonth === 0 || stock.TaxStartMonth === 1)) || monthIndex >= taxStartMonthIndex);

        if (isTaxable && currentValuePerUnit > stock.AveragePrice) {
            const profitPerUnit = (currentValuePerUnit - stock.AveragePrice) / stock.Tani;
            taxPerUnit = profitPerUnit * trialCurrentTaxRate;
        }

        stockDetails.push({
            rate: monthlyRate * 100, // %表示
            value: financialAssetValue,
            kuchisu: stock.Kuchisu,
            currentValuePerUnit: currentValuePerUnit,
            averagePrice: stock.AveragePrice,
            taxPerUnit: taxPerUnit
        });
    }

    return { stockDetails, endOfPeriodAssets };
}

/**
 * モンテカルロ・シミュレーションを実行するメイン関数
 */
function runMonteCarloSimulation(appData) {
    const config = appData.config;
    const stocks = appData.stocks;
    const totalPeriods = config.period * 12;
    const numTrials = config.times;
    const numStocks = stocks.length;
    const meigaraNames = stocks.map(s => s.Meigara);

    if (numStocks === 0) return [];


    // データの準備: 相関行列Rとコレスキー分解L
    const R = numeric.identity(numStocks);
    appData.soukan.forEach(item => {
        const indexA = meigaraNames.indexOf(item.A_Meigara);
        const indexB = meigaraNames.indexOf(item.B_Meigara);
        if (indexA !== -1 && indexB !== -1) {
            R[indexA][indexB] = item.keisu;
            R[indexB][indexA] = item.keisu;
        }
    });

    let L;
    try {
        L = numeric.cholesky(R);
    } catch (error) {
        alert('相関係数に矛盾等がある可能性が高いです。\nエラー: コレスキー分解に失敗しました。' + error.message);
        return [];
    }

    const inflationRate = config.inflationRate / 100; // configから取得した%を小数に変換
    // LifeCostイベントを月数順にソート
    const lifeCostEvents = appData.lifeCost.sort((a, b) => a.month - b.month);
    let lifeCostEventIndex = -1;

    // 1. 初期生活費の特定 (month=0または最も早く発生するイベント)
    let currentMonthlyLifeCost = 0;
    if (lifeCostEvents.length > 0) {
        const initialLifeCostEvent = lifeCostEvents.find(lc => lc.month === 0);

        if (initialLifeCostEvent) {
            // 0ヶ月目のイベントがあればそれを初期値とする
            currentMonthlyLifeCost = initialLifeCostEvent.amount;
            lifeCostEventIndex = lifeCostEvents.indexOf(initialLifeCostEvent);
        } else {
            // 0ヶ月のイベントがない場合は、設定がないとみなし 0 円とする
            currentMonthlyLifeCost = 0;
        }
    } else {
        // lifeCostの設定自体がない場合は0円
        currentMonthlyLifeCost = 0;
    }

    // lifeCostEventIndexが-1の場合、0番目の要素を指すように調整する
    if (lifeCostEventIndex === -1 && lifeCostEvents.length > 0) {
        // たとえ月が0でなくても、最初のイベントを起点としておく
        lifeCostEventIndex = 0;
        currentMonthlyLifeCost = lifeCostEvents[0].amount;
    }

    const simulationResults = [];

    // 全試行回数をループ
    for (let t = 0; t < numTrials; t++) {

        let lifeCostEventIndex = -1;
        let currentMonthlyLifeCost = 0;

        if (lifeCostEvents.length > 0) {
            const initialLifeCostEvent = lifeCostEvents.find(lc => lc.month === 0);
            if (initialLifeCostEvent) {
                currentMonthlyLifeCost = initialLifeCostEvent.amount;
                lifeCostEventIndex = lifeCostEvents.indexOf(initialLifeCostEvent);
            } else {
                currentMonthlyLifeCost = 0;
            }
        } else {
            currentMonthlyLifeCost = 0;
        }

        if (lifeCostEventIndex === -1 && lifeCostEvents.length > 0) {
            lifeCostEventIndex = 0;
            currentMonthlyLifeCost = lifeCostEvents[0].amount;
        }


        let currentCash = config.cash; // (6) 保有現金 (初期値)
        // 銘柄の初期状態をディープコピー
        const currentStocks = stocks.map(s => ({
            ...s,
            Kuchisu: s.Kuchisu,
            CurrentValuePerUnit: s.CurrentValuePerUnit,
            AveragePrice: s.AveragePrice,
        }));
        let fireFailure = false;
        let failureMonth = -1; // 失敗が確定した月数 (0ベース) を記録
        const history = [];

        // シミュレーション期間を月ごとにループ
        for (let monthIndex = 0; monthIndex < totalPeriods; monthIndex++) {

            if (fireFailure) break;
            const yearMonthStr = `${Math.floor(monthIndex / 12)}年${(monthIndex % 12) + 1}月`;

            const transferAssets = monthIndex === 0 ?
                stocks.reduce((sum, s) => sum + (s.Kuchisu / s.Tani * s.CurrentValuePerUnit), 0) :
                history[monthIndex - 1].endOfPeriodAssets;

            // 1. 月次税率の決定
            const trialCurrentTaxRate = calculateTaxRate(monthIndex, appData.tax);

            // 1. 月次インフレとライフコストイベントのチェック
            let lifeCostReset = false;

            // LifeCostイベントの切り替わりチェック (次のイベントがこの月に発生するか)
            if (lifeCostEventIndex + 1 < lifeCostEvents.length) {
                const nextEvent = lifeCostEvents[lifeCostEventIndex + 1];
                if (monthIndex === nextEvent.month) {
                    // A期間からB期間への切替: B期間の予定出費（nextEvent.amount）を基準にリセット
                    // インフレ結果に関わらず、B期間の基準値で再スタートする
                    currentMonthlyLifeCost = nextEvent.amount;
                    lifeCostEventIndex++;
                    lifeCostReset = true;
                }
            }
            // 毎年1月（monthIndexが12で割り切れる、かつ0ヶ月目ではない）にインフレを適用
            // monthIndex 12, 24, 36, ... が 1月（経過1年後、2年後...の1月）
            if (monthIndex > 0 && monthIndex % 12 === 0 && !lifeCostReset) {
                currentMonthlyLifeCost *= (1 + inflationRate);
            }
            const monthlyLifeCostForSimulation = currentMonthlyLifeCost;


            // 2. 収入と出費の処理 (追加投資・売却前の現金残高と不足額を計算)
            const { currentCash: cashAfterIncomeExpense, monthlyIncome, totalExpense, requiredAssetSale } = handleIncomeAndExpense(
                monthIndex,
                currentCash,
                appData,
                monthlyLifeCostForSimulation // インフレ適用済み出費を渡す
            );
            currentCash = cashAfterIncomeExpense;
            let requiredExpense = requiredAssetSale;

            // 3. 追加投資処理
            const tuikaResult = handleTuikaInvestment(monthIndex, currentCash, currentStocks, appData, meigaraNames);
            currentCash = tuikaResult.currentCash;

            // 4. 金融資産の売却 (現金不足の場合)
            let taxPayment = 0;
            if (requiredExpense > 0) {
                const saleResult = handleAssetSale(requiredExpense, currentCash, currentStocks, trialCurrentTaxRate, monthIndex);
                currentCash = saleResult.currentCash;
                taxPayment = saleResult.taxPayment;
                fireFailure = saleResult.fireFailure;
                //資産枯渇によりFIRE失敗 (${yearMonthStr})`
                if (fireFailure) {
                    failureMonth = monthIndex; //ここで失敗月数を記録
                }
            }

            // 5. 利率変動
            const returnResult = applyMonthlyReturn(monthIndex, currentStocks, L, trialCurrentTaxRate);
            const endOfPeriodAssets = returnResult.endOfPeriodAssets;
            const stockDetails = returnResult.stockDetails;

            // 6. 資産枯渇の確認 (総資産)
            const totalAsset = endOfPeriodAssets + currentCash;
            if (totalAsset < 0) {
                fireFailure = true;
                failureMonth = monthIndex; //ここで失敗月数を記録
            }

            // 月次履歴を記録
            history.push({
                yearMonth: yearMonthStr,
                transferAssets: transferAssets, // (2) 引継金融資産額
                expense: totalExpense, // (3) 出費 ← expenseResult.totalExpense を totalExpense に変更
                income: monthlyIncome, // (4) 収入 ← expenseResult.monthlyIncome を monthlyIncome に変更
                tax: taxPayment, // (5) 税金
                cash: currentCash, // (6) 保有現金 (月末残高)
                tuika: tuikaResult.monthlyTuikaInvestment, // (7) 追加投資
                endOfPeriodAssets: endOfPeriodAssets, // (8) 期末金融資産額
                totalAsset: totalAsset, // (9) 総資産
                stockDetails: stockDetails,
                isFailure: fireFailure
            });
        }

        simulationResults.push({
            trialId: t + 1,
            success: !fireFailure,
            failureMonth: fireFailure ? failureMonth : totalPeriods,
            history: history
        });
    }
    return simulationResults;
}

// --- モンテカルロ・シミュレーションのプログラム終了 ---

//チャート生成用
let totalAssetChartInstance = null;

//すべての処理の前に登録データを整理する
function initializeDatas() {
    //追加投資の終了年月をシミュレーションの年月に変換する
    const appDatas = JSON.parse(localStorage.getItem('fireSimulatorData')) || {};
    let new_data = [];
    for (let w of appDatas.tuika) {
        if (w.pattern === "１回") {
            w.toMonth_totalMonths = w.month;
        }
        else {
            //終了年月をシミュレーションの年月に変換する
            w.toMonth_totalMonths = compareMonthAndGetCurrent(w.toMonth);
        }
        new_data.push(w);
    }
    appDatas.tuika = new_data;
    localStorage.setItem('fireSimulatorData', JSON.stringify(appDatas));
}

// ... (DOM操作と表示制御のコードは変更なし) ...
document.addEventListener('DOMContentLoaded', () => {
    //処理前にデータを整理する
    initializeDatas();

    const simulationButtonsDiv = document.getElementById('simulation-buttons');
    const summaryText = document.getElementById('summary-text');
    const detailSection = document.getElementById('simulation-detail');
    const detailTitle = document.getElementById('detail-title');
    const detailTableBody = document.getElementById('detail-table-body');
    const failureFilter = document.getElementById('failure-filter');
    const meigaraLegend = document.getElementById('meigara-legend');
    const headerRow1 = document.getElementById('header-row-1');
    const headerRow2 = document.getElementById('header-row-2');

    const chartContainer = document.getElementById('chart-container'); // グラフコンテナを取得
    const totalAssetChartCanvas = document.getElementById('totalAssetChart'); // Canvas要素を取得

    let simulationResults = [];
    let currentTrialIndex = -1;
    let meigaraNames = [];

    /**
     * 銘柄ごとのヘッダーセルを動的に生成する
     * @param {Array} stocks - 銘柄情報の配列
     */
    function setupTableHeader(stocks) {
        let child = headerRow1.lastElementChild;
        while (child && child.id !== 'header-row-1-month') {
            if (headerRow1.children.length > 1) {
                headerRow1.removeChild(headerRow1.lastElementChild);
            } else {
                break;
            }
            child = headerRow1.lastElementChild;
        }

        while (headerRow2.children.length > 9) {
            headerRow2.removeChild(headerRow2.lastChild);
        }

        meigaraNames = stocks.map(s => s.Meigara);

        // 銘柄の数だけヘッダーを追加
        stocks.forEach((stock, index) => {
            // 1行目: 銘柄名
            const th1 = document.createElement('th');
            th1.colSpan = "4";
            th1.textContent = `銘柄${String.fromCharCode(65 + index)}`

            th1.classList.add('meigara-header-group');
            th1.classList.add('collapsed-detail-text');
            th1.dataset.meigaraIndex = index; // 0, 1, 2, ... のインデックス

            headerRow1.appendChild(th1);

            // 2行目: 詳細項目 (4つのセル)
            const th2_rate = document.createElement('th');
            th2_rate.textContent = '利率％';
            th2_rate.classList.add('meigara-header-group');
            th2_rate.classList.add('collapsed-detail-text');
            headerRow2.appendChild(th2_rate);

            const th2_value = document.createElement('th');
            th2_value.textContent = '資産額';
            th2_value.classList.add('meigara-header-group');
            th2_value.classList.add('collapsed-detail-text');
            headerRow2.appendChild(th2_value);

            const th2_kuchisu = document.createElement('th');
            th2_kuchisu.textContent = '保有口数';
            th2_kuchisu.classList.add('meigara-header-group');
            th2_kuchisu.classList.add('collapsed-detail-text');
            headerRow2.appendChild(th2_kuchisu);

            const th2_price = document.createElement('th');
            th2_price.innerHTML = '現在/<br>平均<br>(税額/1口)';
            th2_price.classList.add('meigara-header-group');
            th2_price.classList.add('collapsed-detail-text');
            headerRow2.appendChild(th2_price);
        });

        // 1行目の共通項目のヘッダー（月次収支・資産総額）を動的に追加
        const th1_common = document.createElement('th');
        th1_common.colSpan = "8";
        th1_common.textContent = '月次収支・資産総額';
        headerRow1.insertBefore(th1_common, headerRow1.children[1]);

        // 凡例の設定
        const legendHtml = '<h3>凡例</h3>';
        meigaraLegend.innerHTML = legendHtml + stocks.map((s, i) =>
            '<button class="hanrei_button" onclick="showHideStocksInfo(' + `${i}` + ',this)">' + `銘柄${String.fromCharCode(65 + i)}: ${s.Meigara}` + '</button>'
        ).join('<br><br>') + '<BR><BR>※　凡例の「銘柄A、銘柄B・・・」をクリックすると、各銘柄の推移の表示・非表示を切り替えられます。<br>';
    }


    /**
     * シミュレーション詳細テーブルに結果を表示
     * @param {number} trialIndex - 表示する試行のインデックス
     * @param {HTMLElement} clickedButton - クリックされたボタン要素
     */
    function displaySimulationDetail(trialIndex, clickedButton) {
        currentTrialIndex = trialIndex;
        const result = simulationResults[trialIndex];
        const history = result.history;

        detailTitle.textContent = `シミュレーション詳細（試行 #${result.trialId} - ${result.success ? '成功' : '失敗'}）`;
        detailTableBody.innerHTML = ''; // テーブルをクリア

        history.forEach((entry, historyIndex) => {
            const row = detailTableBody.insertRow();

            // (1) 年月
            let rowHtml = `<td class="text-left">${entry.yearMonth}</td>`;

            // (2) 引継金融資産額 
            let transferAssets = entry.transferAssets;
            rowHtml += `<td>${window.formatNumber(transferAssets)}</td>`;

            // (3) 出費 - 手取りとして必要な金額 
            rowHtml += `<td>${window.formatNumber(entry.expense)}</td>`;
            // (4) 収入
            rowHtml += `<td>${window.formatNumber(entry.income)}</td>`;
            // (5) 税金
            rowHtml += `<td>${window.formatNumber(entry.tax)}</td>`;
            // (6) 保有現金
            rowHtml += `<td>${window.formatNumber(entry.cash)}</td>`;
            // (7) 追加投資
            rowHtml += `<td>${window.formatNumber(entry.tuika)}</td>`;

            // (8) 期末金融資産額 - ( )をつけた対前月比の差を記載
            const investmentChange = entry.endOfPeriodAssets - (entry.transferAssets + entry.tuika);
            const assetChangeText = `${window.formatNumber(entry.endOfPeriodAssets)}<br>(${window.formatNumber(investmentChange)})`;
            rowHtml += `<td>${assetChangeText}</td>`;

            // (9) 総資産
            rowHtml += `<td>${window.formatNumber(entry.totalAsset)}</td>`;

            // 銘柄ごとの資産額の表示
            entry.stockDetails.forEach((stock, stockIndex) => {
                const initialStockData = window.appData.stocks[stockIndex];

                // *保有口数の残数（セル）*
                const prevStockKuchisu = historyIndex === 0 ? initialStockData.Kuchisu : history[historyIndex - 1].stockDetails[stockIndex].kuchisu;
                const kuchisuChange = stock.kuchisu - prevStockKuchisu;
                const kuchisuChangeText = kuchisuChange > 0 ? `<span class="kuchisu-increase">(+${window.formatNumber(kuchisuChange)})</span>` : `(${window.formatNumber(kuchisuChange)})`;
                const kuchisuCell = `${window.formatNumber(stock.kuchisu)}<br>${kuchisuChangeText}`;

                // *現在価額/平均取得価額（セル）*
                const currentValuePerUnit = stock.currentValuePerUnit;
                const averagePrice = stock.averagePrice;
                const priceLine = `${window.formatNumber(currentValuePerUnit)}/${window.formatNumber(averagePrice)}`;

                const taxPerUnitText = stock.taxPerUnit > 0.0000001 ? `(${stock.taxPerUnit.toFixed(4)}円/口)` : `無税`;

                const priceCell = `${priceLine}<br>${taxPerUnitText}`;

                // 銘柄の詳細情報のセルを追加
                rowHtml += `
                            <td class='collapsed-detail-text'>${stock.rate.toFixed(2)}%</td>
                            <td class='collapsed-detail-text'>${window.formatNumber(stock.value)}</td>
                            <td class='collapsed-detail-text'>${kuchisuCell}</td>
                            <td class='collapsed-detail-text'>${priceCell}</td>
                        `;
            });

            row.innerHTML = rowHtml;
            detailTableBody.appendChild(row);
        });

        detailSection.style.display = 'block';


        //グラフ描画ロジックの追加
        const labels = history.map(entry => entry.yearMonth);
        const data = history.map(entry => entry.totalAsset);

        const ctx = document.getElementById('totalAssetChart').getContext('2d');

        // 既存のグラフがあれば破棄して新しい描画に備える
        if (totalAssetChartInstance) {
            totalAssetChartInstance.destroy();
        }

        // 新しい折れ線グラフを作成
        totalAssetChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    // 線形軸（左）にプロットするデータセット (必要に応じて残す)
                    {
                        label: '(9) 総資産の推移 (線形)',
                        data: data,
                        yAxisID: 'y', // 左側の軸を指定
                        borderColor: result.success ? '#3498db' : '#e74c3c',
                        backgroundColor: result.success ? 'rgba(52, 152, 219, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1,
                        fill: false // 2つのプロットが重なるため、塗りつぶしはしない方が見やすい
                    },
                    // 対数軸（右）にプロットするデータセット (色は線形軸と変える)
                    {
                        label: '(9) 総資産の推移 (対数)',
                        data: data,
                        yAxisID: 'y2', // ★右側の対数軸を指定
                        borderColor: 'rgba(155, 89, 182, 1)', // 対数軸用に色を変更
                        backgroundColor: 'rgba(155, 89, 182, 0.1)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1,
                        fill: false,
                        hidden: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `試行 #${result.trialId} の総資産の推移 (${result.success ? '成功' : '失敗'})`
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '期間'
                        },
                        ticks: {
                            autoSkip: true,
                            maxTicksLimit: 20
                        }
                    },
                    y: { // 左側の通常の軸
                        title: {
                            display: true,
                            text: '総資産額 (線形)'
                        },
                        beginAtZero: false,
                        ticks: {
                            callback: function (value) {
                                return window.formatNumber(value);
                            }
                        }
                    },
                    y2: { // 右側の対数軸を新設
                        type: 'logarithmic', // ★ここを 'logarithmic' に変更
                        position: 'right', // 軸を右側に配置
                        title: {
                            display: true,
                            text: '総資産額 (対数)'
                        },
                        grid: {
                            drawOnChartArea: false, // グラフ領域へのグリッド線描画を無効化
                        },
                        ticks: {
                            callback: function (value) {
                                // 対数軸の目盛りを分かりやすくフォーマット
                                return window.formatNumber(value);
                            }
                        }
                    }
                }
            }
        });


        // --- ★グラフコンテナの位置計算と表示 ---
        if (clickedButton) {
            const buttonRect = clickedButton.getBoundingClientRect();
            const containerRect = simulationButtonsDiv.getBoundingClientRect(); // ボタンコンテナの位置

            // ボタンの下端を基準に位置を計算 (スクロール位置も考慮)
            let topPosition = window.scrollY + buttonRect.bottom;
            let leftPosition = window.scrollX;

            // 画面下部にはみ出す場合の調整 (簡易的)
            const chartHeight = 350 + 20 + 2; // min-height + padding + border
            if (topPosition + chartHeight > window.scrollY + window.innerHeight) {
                topPosition = window.scrollY + buttonRect.top - chartHeight; // ボタンの上に表示
                if (topPosition < window.scrollY) { // 画面上部にもはみ出すなら中央付近に
                    topPosition = window.scrollY + 50;
                }
            }

            // 画面右側にはみ出す場合の調整
            const chartWidth = 600 + 20 + 2; // width + padding + border
            if (leftPosition + chartWidth > window.scrollX + window.innerWidth) {
                leftPosition = window.scrollX + window.innerWidth - chartWidth - 10; // 右端に寄せる
            }
            if (leftPosition < window.scrollX) { // 画面左にもはみ出すなら中央付近に
                leftPosition = window.scrollX + 10;
            }
            chartContainer.style.top = `${Math.max(0, topPosition)}px`;
            chartContainer.style.left = `${Math.max(0, leftPosition)}px`;
            chartContainer.style.display = 'block';
        } else {
            chartContainer.style.display = 'none'; // ボタン情報がない場合は非表示
        }
    }

    /**
     * シミュレーションボタンの表示を更新
     * @param {boolean} showFailuresOnly - 失敗ケースのみを表示するかどうか
     */
    function updateSimulationButtons(showFailuresOnly) {
        simulationButtonsDiv.innerHTML = '';
        chartContainer.style.display = 'none';

        simulationResults.forEach((result, index) => {
            if (showFailuresOnly && result.success) return;

            const button = document.createElement('button');
            button.id = `result-${result.trialId}`;
            button.className = `simulation-button ${result.success ? 'success' : 'failure'}`;
            button.textContent = result.trialId;

            button.addEventListener('click', () => {
                showHideStocksInfo(-1,null);        //ボタンを押した直後は銘柄の詳細は非表示
                displaySimulationDetail(index, button);
            });

            simulationButtonsDiv.appendChild(button);
        });

        // 成功/失敗のサマリーを更新
        const successCount = simulationResults.filter(r => r.success).length;
        const failureCount = simulationResults.length - successCount;
        const successRate = (simulationResults.length > 0 ? successCount / simulationResults.length * 100 : 0).toFixed(1);

        // 1. 成功ケースの統計 (最終総資産)
        const successfulFinalAssets = simulationResults
            .filter(r => r.success)
            .map(r => r.history[r.history.length - 1].totalAsset);

        let medianAsset = 0;
        let worst10thAsset = 0;

        if (successfulFinalAssets.length > 0) {
            medianAsset = calculatePercentile(successfulFinalAssets, 50);
            worst10thAsset = calculatePercentile(successfulFinalAssets, 10);
        }

        // 2. 失敗ケースの統計 (最終総資産と失敗月数)
        const failureFinalAssets = simulationResults
            .filter(r => !r.success)
            .map(r => r.history[r.history.length - 1].totalAsset);

        const failureMonths = simulationResults
            .filter(r => !r.success)
            .map(r => r.failureMonth + 1); // 0ベースの月数に+1して表示月数に

        let medianFailureAsset = 0;
        let medianFailureMonth = 0;

        if (failureFinalAssets.length > 0) {
            medianFailureAsset = calculatePercentile(failureFinalAssets, 50);

            // 失敗確定期間の中央値（月数）を計算
            medianFailureMonth = calculatePercentile(failureMonths, 50);
        }

        // 3. 全体評価の生成
        const overallAssessment = generateOverallAssessment(parseFloat(successRate), worst10thAsset);

        // 4. サマリーテキストの更新 (HTML構造の変更)
        // 月数を「X年 Yヶ月」形式に変換するヘルパー関数
        const formatMonths = (months) => {
            const totalMonths = Math.round(months);
            if (totalMonths <= 0) return "開始時";
            const years = Math.floor(totalMonths / 12);
            const m = totalMonths % 12;
            if (years > 0) {
                return `${years}年${m}ヶ月`;
            }
            return `${m}ヶ月`;
        };

        summaryText.innerHTML = `
			    <h2>全体評価</h2>
			    <p style="font-size: 1.2em; font-weight: bold; color: #2980b9;">
			        ${overallAssessment}
			    </p>
			    <hr style="margin: 15px 0;">

			    **試行回数:** ${simulationResults.length}回<br>
			    **FIRE成功率:** <span style="color:#3498db; font-size: 1.1em; font-weight: bold;">${successRate}%</span> (${successCount}回)<br>
			    **FIRE失敗率:** <span style="color:#e74c3c; font-size: 1.1em; font-weight: bold;">${(100 - successRate).toFixed(1)}%</span> (${failureCount}回)
			    <hr style="margin: 10px 0;">

			    <div style="display: flex; justify-content: space-around; text-align: left; padding: 10px;">
			        <div style="padding-right: 15px; flex: 1;">
		            <h3>✅ 成功ケース (最終総資産予測)</h3>
		            <p>
		                <span style="font-weight: bold;">中央値 (50%タイル):</span> ${window.formatNumber(Math.round(medianAsset))} 円<br>
		                <span style="font-weight: bold; color: #e67e22;">悲観的なケース (10%タイル):</span> ${window.formatNumber(Math.round(worst10thAsset))} 円
		            </p>
		            <span style="font-size: 0.9em; display: block;">※ 90%の確率で、10%タイル以上の資産が残ります。</span>
			        </div>
        
			        <div style="border-left: 1px solid #ccc; padding-left: 15px; flex: 1;">
			            <h3>❌ 失敗ケース (リスク分析)</h3>
			            <p>
			                <span style="font-weight: bold;">失敗までの期間 (中央値):</span> ${formatMonths(medianFailureMonth)}<br>
			                <span style="font-weight: bold; color: #c0392b;">終了時資産 (中央値):</span> ${window.formatNumber(Math.round(medianFailureAsset))} 円
			            </p>
			            <span style="font-size: 0.9em; display: block;">※ 失敗リスクが発生した場合、この期間で資産が枯渇する可能性が高いです。</span>
			        </div>
			    </div>
			`;
    }

    /**
         * 配列から指定されたパーセンタイル値を計算する
         * @param {Array<number>} data - 数値の配列
         * @param {number} percentile - 求めるパーセンタイル (0-100)
         * @returns {number} パーセンタイル値
         */
    function calculatePercentile(data, percentile) {
        if (data.length === 0) return 0;
        const sortedData = [...data].sort((a, b) => a - b);
        const index = (percentile / 100) * (sortedData.length - 1);
        if (index % 1 === 0) {
            return sortedData[index];
        } else {
            const lower = Math.floor(index);
            const upper = Math.ceil(index);
            const weight = index - lower;
            return sortedData[lower] * (1 - weight) + sortedData[upper] * weight;
        }
    }

    /**
         * 成功率と悲観的なケースの資産額に基づき、総合的な評価文を生成する
         */
    function generateOverallAssessment(successRate, worst10thAsset) {
        let assessment = "";

        if (successRate >= 99) {
            stars = '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐';
            comment = `【評価：FIREしないリスクを検討しましょう😊】成功率 ${successRate.toFixed(1)} です。😊もはや、FIREせずに仕事を続けることのリスクを検討する段階です。<br>好きなことを仕事にしているなら続けましょう。<br>ですが、我慢をしている仕事ならば１度しかない人生だということも理解しておきましょう。<br>資産計画は極めて優秀です。【FIRE後、何をするか？】に注力しましょう。<br>健康寿命は思っている以上に短いですよ。`;
        } else if (successRate >= 95) {
            stars = '⭐⭐⭐⭐⭐⭐⭐⭐⭐☆';
            comment = `【評価：極めて高い確実性】成功率 ${successRate.toFixed(1)} で、あなたのFIRE計画は極めて高い確実性を持っています。<br>資産が枯渇する確率は非常に低いですが、さらなる特異な出費や、一時的な自国通貨安、または複数の危機が重なる「パーフェクトストーム」のような事態が連続すれば、最悪のシナリオでは枯渇する可能性も残ります。<br>計画は優秀ですが、まだ、穴があるようです。債券などの組み合わせも検討すれば、より確実なFIREができるかもしれません。<br>あわせて、FIRE後にすることを、そろそろ始めても良いころでは？`;
        } else if (successRate >= 90) {
            stars = '⭐⭐⭐⭐⭐⭐⭐☆☆☆';
            comment = `【評価：高い確実性だがリスクあり】成功率 ${successRate.toFixed(1)} は、比較的高い確実性です。<br>${(100 - successRate).toFixed(1)}%の確率で資産が尽きる未来が示されています。<br>予期せぬ大きな出費や、市場が長期間停滞する「パーフェクトストーム」のような事態が重なった場合、資産は枯渇します。<br>このリスクを真剣に受け止め、万が一の場合の収入源を確保するなど、より厳しい検討が必要です。<br>FIREはもう見えています。FIRE後にすることもきちんと計画しておきましょう。膨大な時間を有意義に消費するために。`;
        } else if (successRate >= 80) {
            stars = '⭐⭐⭐⭐⭐☆☆☆☆☆';
            comment = `【評価：危険水域・十分な検討が必要】成功率 ${successRate.toFixed(1)} は、FIREの確実性としては不十分です。<br>成功と失敗が約20%の差で発生しており、資産が枯渇する可能性は無視できません。<br>特異な出費や、一時的な自国通貨安、またはインフレの予想以上の進行が重なる最悪のケースでは、計画は容易に破綻します。<br>計画を実行に移す前に、資産の増強や生活費の見直しを強く推奨します。<br>FIREではなく、独立したい！というのであれば、生活への保険を掛けた状態で勝負に出ることができる水準です。もちろん運転資金としてこの資産に手を付けちゃだめですよ💦`;
        } else if (successRate >= 50) {
            stars = '⭐⭐⭐☆☆☆☆☆☆☆';
            comment = `【評価：極めて危険】成功率 ${successRate.toFixed(1)} は、失敗する確率が成功する確率とほとんど変わりません。<br>この状態でFIREを思考するのは極めて危険です。ほんの少しの事態で、あっという間に資産は枯渇します。<br>現状のデータでは正社員を辞めるべきではありません。適度にアルバイトすれば…は、現実逃避です。経済的独立は成立していません。<br>素直に会社員を続けましょう。`;
        } else if (successRate >= 40) {
            stars = '⭐⭐☆☆☆☆☆☆☆☆';
            comment = `【評価：ダメ絶対】成功率 ${successRate.toFixed(1)} は、シミュレーションの大半で資産が枯渇するという結果になりました。<br>この状態ではFIREのFの字すら語る段階では、まだありません。`;
        } else if (successRate >= 20) {
            stars = '⭐☆☆☆☆☆☆☆☆☆';
            comment = `【評価：え？】成功率 ${successRate.toFixed(1)}でした。<br>定率で右肩上がりに利益が出る非現実的なシミュレーターで満足しておくべき段階です。`;
        } else {
            stars = '☆☆☆☆☆☆☆☆☆☆';
            comment = `成功率 ${successRate.toFixed(1)} です。`;
        }

        assessment = stars + "<BR>" + comment;
        if (successRate >= 50 && worst10thAsset <= 0) {
            assessment += "<br>→ **【注意】** 成功ケースであっても、運が悪いと資産がほとんど残らない（またはマイナスになる）可能性があります。";
        }

        return assessment;
    }

    // --- ★グラフ非表示のためのダブルクリックイベントリスナーを追加 ---
    chartContainer.addEventListener('dblclick', () => {
        chartContainer.style.display = 'none';
        if (totalAssetChartInstance) {
            totalAssetChartInstance.destroy(); // グラフインスタンスも破棄
            totalAssetChartInstance = null;
        }
    });



    // --- メイン処理 ---
    const storedData = localStorage.getItem('fireSimulatorData');
    if (!storedData) {
        summaryText.textContent = 'エラー: 設定データがLocalStorageに見つかりません。設定ページでデータを保存してください。';
        return;
    }

    try {
        //各種設定ページの設定情報の読み込み
        const appData = JSON.parse(storedData);
        window.appData = appData;

        if (!appData.stocks || appData.stocks.length === 0) {
            summaryText.textContent = 'エラー: 保有銘柄が登録されていません。シミュレーションを実行できません。';
            return;
        }

        // 1. ヘッダーの初期設定と凡例の準備
        setupTableHeader(appData.stocks);

        // 2. シミュレーションの実行 (simulate.htmlを開いた直後に開始)
        simulationResults = runMonteCarloSimulation(appData);

        // 3. 結果の表示
        updateSimulationButtons(false);

        // 4. 絞り込み機能のイベントリスナー
        failureFilter.addEventListener('change', (event) => {
            updateSimulationButtons(event.target.checked);
        });

    } catch (e) {
        summaryText.textContent = `データの読み込みまたはシミュレーション実行中にエラーが発生しました: ${e.message}`;
    }
});

//シミュレーション詳細のテーブルの各銘柄の資産状況の推移情報の表示・非表示処理
function showHideStocksInfo(meigaraIndex, event) {
    //ボタンが押された直後は銘柄情報は非表示
    if(meigaraIndex === -1){
        let elements = document.querySelectorAll('.meigara-header-group');
        elements.forEach(element => {
            element.classList.add('collapsed-detail-text');
        });
        elements = document.querySelectorAll('.hanrei_button');
        elements.forEach(element => {
            element.classList.remove('showed-detail-button');
        });
        return;
    }

    //押した銘柄のボタンの状態変更
    event.classList.toggle('showed-detail-button');

    // テーブルのすべての行 (ヘッダー行とデータ行) を取得
    const allRows = document.querySelectorAll('#detail-table tr');

    //1行目の銘柄A、銘柄B・・・の表示・非表示の変更
    const column = allRows[0].querySelectorAll('td, th')[meigaraIndex + 2];
    column.classList.toggle('collapsed-detail-text');

    // 銘柄の開始列インデックスを計算 (1-based index)
    const startColumnIndex_1based = 10 + (meigaraIndex * 4);
    //銘柄の詳細項目数を取得
    const COLUMNS_PER_STOCK = 4;
    //2行目以降の銘柄の詳細情報の表示・非表示の変更
    allRows.forEach(row => {
        // 4つの列をまとめて操作
        for (let i = 0; i < COLUMNS_PER_STOCK; i++) {
            // 行が 'header-row-2' の場合、共通項目数は8（rowspan=2の影響で1つ少ない）
            let columnIndex_1based = startColumnIndex_1based + i;
            if (row.id === 'header-row-1') {	//1行目は別途処理する
                continue;
            }
            if (row.id === 'header-row-2') {	//２行目だけ特殊なので、対象列を１つずらす
                columnIndex_1based--;
            }
            // CSSの :nth-child(n) セレクタを使ってセルを取得
            const cell = row.querySelector(`:nth-child(${columnIndex_1based})`);
            if (cell) {
                //選択した銘柄の詳細を表示・非表示を切り替える
                cell.classList.toggle('collapsed-detail-text');
            }
        }
    });
}
