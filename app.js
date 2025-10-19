// アプリケーション全体のデータを保持するオブジェクト
// 初期値を設定しておくことで、入力がない場合でもエラーを防ぎます。
const appData = {
    config: {
        period: 20,
        times: 100,
        birthDate: '2000-01-01',
        cash: 0,
	inflationRate: 2.0 // インフレ率（%）。デフォルト2.0%
    },
    stocks: [],
    soukan: [],
    tuika: [],
    lifeCost: [],
    bigExpense: [],
    income: [],
    tax: []
};

window.appData = appData;
// app.jsがロードされた瞬間にlocalStorageから設定データを読み込み、appDataを更新する
const storedData = localStorage.getItem('fireSimulatorData');
if (storedData) {
    try {
        const loadedData = JSON.parse(storedData);
        Object.keys(loadedData).forEach(key => {
            // 既存のappDataのキーを更新
            appData[key] = loadedData[key];
        });
        // 注意: appDataは参照渡しのため、window.appData = appData; を再実行する必要はありません。
    } catch (e) {
        console.error("Local Storageデータの解析に失敗しました。", e);
        // ロードに失敗した場合はデフォルト値のまま処理を続行します。
    }
}
// グローバルスコープ（app.jsなど）で利用可能にする
window.downloadAllSettings = downloadAllSettings;



// --- 共通ユーティリティ関数 ---

// 数値をカンマ区切りで整形する関数
window.formatNumber = (num) => {
    if (num === null || num === undefined) return '-';
    // 小数点以下を丸める（ここでは四捨五入）
    const rounded = Math.round(num);
    return rounded.toLocaleString();
};

//数値を３桁毎のカンマ区切りに整形する関数
window.formatNumberInput = (event) => {
    // 1. 入力値を取得
    let value = event.target.value;
    
    // 2. 既存のカンマを全て削除
    value = value.replace(/,/g, '');
    
    // 3. 数値以外、または空文字列の場合は処理を終了
    // isNaN(value) は空文字列 "" に対して false を返すため、空文字列のチェックも必要
    if (isNaN(value) || value === '') {
        event.target.value = value; // 空文字列やハイフンなどをそのまま残す
        return;
    }
    
    // 4. 小数点以下があるか確認し、整数部と小数部に分ける (ただし、ここでは整数のみを想定し、小数点以下は無視)
    // big_expense.htmlでは amount を parseInt() しているため、ここでは単純な整数処理とする。
    
    // 5. カンマ区切りを適用
    const formattedValue = value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    
    // 6. 入力フィールドの値を更新
    event.target.value = formattedValue;
};


// 月数から 年 / 月 の文字列を生成
window.formatMonthToYearMonth = (totalMonths) => {
    if (totalMonths === null || totalMonths === undefined) return '---';
    const year = Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    return `${year}年${month}月`;
};

/**
 * 実行年月と引数の年月を比較し、条件に応じた値を返します。
 *
 * @param {string} targetYm - 比較対象の年月 ('yyyy-mm' 形式)
 * @returns {number} - 実行年月 >= targetYm の場合は 1。
 * 実行年月 < targetYm の場合は、実行年月と targetYm の月数の差を返します。
 */
window.compareMonthAndGetCurrent = (targetYm) =>{
    // 実行年月の取得
    const now = new Date();
    // 実行年月の「年」と「月 (0-11)」を取得
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12月に変換

    // 引数の年月のパース
    const parts = targetYm.split('-');
    if (parts.length !== 2) {
        throw new Error("引数の形式が不正です。'yyyy-mm' 形式で指定してください。");
    }
    const targetYear = parseInt(parts[0], 10);
    const targetMonth = parseInt(parts[1], 10);

    // 有効な数値かどうかの確認
    if (isNaN(targetYear) || isNaN(targetMonth) || targetMonth < 1 || targetMonth > 12) {
        throw new Error("引数の年月が不正な値を含んでいます。");
    }

    // 実行年月を月数に変換 (基準: 0年1月)
    const currentTotalMonths = currentYear * 12 + currentMonth;
    // 比較対象の年月を月数に変換 (基準: 0年1月)
    const targetTotalMonths = targetYear * 12 + targetMonth;

    // 比較
    if (currentTotalMonths >= targetTotalMonths) {
        // 実行年月 >= yyyy-mm のとき
        return 0;
    } else {
        // 実行年月 < yyyy-mm のとき
        // 差を月数で取得 (実行年月 - yyyy-mm)
        // 例: 実行年月=2025/10, targetYm=2025/12 の場合、1263 - 1261 = 2
        const monthDifference = targetTotalMonths - currentTotalMonths;
        return monthDifference;
    }
}

/**
 * fromDate と toDate の関係をチェックし、特定の条件で false を返す関数
 * @param {string} fromDate - 開始日 ("yyyy-mm" 形式)
 * @param {string} toDate - 終了日 ("yyyy-mm" 形式)
 * @returns {boolean} - チェック条件を満たす場合は false、それ以外は true
 */
window.isValidDateRange = (fromDate, toDate) => {
    // 1. fromDateが空白、かつ、toDateに年月データが代入されている
    // trim()で前後空白を削除してからチェックします。
    const isFromEmpty = (!fromDate || fromDate.trim() === "");
    const isToEmpty = (!toDate || toDate.trim() === "");
    const isToPresent = (toDate && toDate.trim() !== "");

    //両方空白のとき
    if(isFromEmpty && isToEmpty) {
        return false;
    }

    //fromが空白なのに、toに値があるとき
    if (isFromEmpty && isToPresent) {
        return false;
    }

    // fromDateとtoDateの両方に値がある場合のみ、日付の大小関係をチェックします。
    if (!isFromEmpty && isToPresent) {
        // Dateオブジェクトを作成し、比較します。
        // "yyyy-mm" に "-01" を加えて、月の最初の日として解釈させます。
        const from = new Date(`${fromDate}-01`);
        const to = new Date(`${toDate}-01`);

        // 2. fromDate > toDate の日付の関係になっている
        // 日付オブジェクトの比較は、getTime() もしくはそのままの比較で可能です。
        if (from > to) {
            return false;
        }
    }

    // 上記の条件に該当しない場合は true を返します。
    return true;
}



// --- データ保存・読み込み機能 ---
document.addEventListener('DOMContentLoaded', () => {
    // ページによってはこれらのボタンが存在しないため、存在チェックも追加
    const saveButton = document.getElementById('saveButton');
    const loadButton = document.getElementById('loadButton');

    if (saveButton) {
        saveButton.addEventListener('click', () => {
            // appDataオブジェクトをJSON文字列に変換してlocalStorageに保存
            try {
                localStorage.setItem('fireSimulatorData', JSON.stringify(appData));
                alert('設定が保存されました！');
            } catch (e) {
                alert('設定の保存に失敗しました。');
            }
        });
    }

    if (loadButton) {
        loadButton.addEventListener('click', () => {
            // localStorageからデータを読み込み、appDataを上書き
            try {
                const storedData = localStorage.getItem('fireSimulatorData');
                if (storedData) {
                    const loadedData = JSON.parse(storedData);
                    // 既存のappDataのキーを更新
                    Object.keys(loadedData).forEach(key => {
                        appData[key] = loadedData[key];
                    });
                    alert('設定が読み込まれました！');
                    // ページが設定画面の場合は、データを画面に反映させる関数を呼び出す必要があります
                    if (window.loadConfig) window.loadConfig();
                    if (window.loadStocks) window.loadStocks();
                    // ... 他の設定画面のロード関数
                } else {
                    alert('保存された設定が見つかりませんでした。');
                }
            } catch (e) {
                alert('設定の読み込みに失敗しました。');
            }
        });
    }
});


/**
 * Local Storageに保存されている全設定をJSON形式で整形し、ファイルとしてダウンロードさせる
 * @param {string} filename - ダウンロードするファイル名
 */
function downloadAllSettings(filename = 'FIRE_Settings_Export.json') {
    // 1. Local Storageから全設定データを取得
    const appDataString = localStorage.getItem('fireSimulatorData');
    
    if (!appDataString) {
        alert('保存された設定データが見つかりません。まず各設定を保存してください。');
        return;
    }

    // 2. データ収集に適した形に整形（匿名化はユーザー側で確認できないため、ここでは生のJSONを整形）
    // JSON文字列をパースして、整形（インデント）して文字列に戻す
    const appData = JSON.parse(appDataString);
    const formattedData = JSON.stringify(appData, null, 2); // null, 2 でインデントを適用

    // 3. ダウンロード用のBlob（バイナリラージオブジェクト）を作成
    const blob = new Blob([formattedData], { type: 'application/json;charset=utf-8' });

    // 4. ダウンロードリンクを作成し、クリックイベントを発生させる
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    
    // DOMに追加して即座にクリックし、ダウンロードを実行
    document.body.appendChild(a);
    a.click();
    
    // 後処理
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('設定ファイル（' + filename + '）をダウンロードしました。');
}

/**
 * ユーザーが選択したJSONファイル（設定ファイル）を読み込み、
 * Local Storageに反映させる
 */
function loadAllSettings() {
    // 隠しファイル選択インプットを作成
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json'; // JSONファイルのみを受け付ける

    fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                const newAppData = JSON.parse(content);
                
                // 必須チェック: FIREシミュレータのデータ構造か確認（最低限configがあるか）
                if (!newAppData || typeof newAppData !== 'object' || !newAppData.config) {
                    alert('エラー: ファイルの内容が正しくありません。FIREシミュレータの設定ファイルであることを確認してください。');
                    return;
                }

                // Local Storageに上書き保存
                localStorage.setItem('fireSimulatorData', JSON.stringify(newAppData));
                
                alert('設定ファイルを読み込み、Local Storageに保存しました！\n各設定画面で内容をご確認ください。');
                
                // 読み込み後、メイン画面をリロードして反映
                window.location.reload(); 

            } catch (error) {
                alert('ファイルの解析に失敗しました。ファイルが破損しているか、JSON形式ではありません。');
                console.error('File load error:', error);
            }
        };
        // ファイルをテキスト（文字列）として読み込む
        reader.readAsText(file);
    };

    // ファイル選択ダイアログを起動
    fileInput.click();
}
