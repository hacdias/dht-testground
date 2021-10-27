const { invokeMap } = require('@testground/sdk')

const testCases = {
  'peer-routing': require('./peer-routing'),
  'content-routing': require('./content-routing')
}

;(async () => {
  // This is the plan entry point.
  await invokeMap(testCases)
})()
