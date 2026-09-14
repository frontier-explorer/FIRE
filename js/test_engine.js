global.window = global;
require('./bond.js');
require('./retirementTax.js');
require('./engine.js');
require('./state.js');

const appData = window.FireState.createDefaultAppData();
appData.config.times = 5;
appData.config.period = 30;

try {
  const results = window.FireEngine.runSimulation(appData, () => {});
  console.log('trials:', results.length);
  results.forEach((r, i) => {
    console.log('trial', i+1, 'success:', r.success, 'historyLen:', r.history.length, 'lightHistoryLen:', r.lightHistory.length);
    if (r.history.length > 0) {
      const rec = r.history[0];
      console.log('  first record regime:', rec.regime, 'cashBufferMode:', rec.cashBufferMode, 'effectiveMode:', rec.effectiveMode, 'jgbBufferValue:', rec.jgbBufferValue);
    }
  });
} catch (e) {
  console.error('ERROR:', e.stack);
}
