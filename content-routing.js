const delay = require('delay')
const PeerId = require('peer-id')
const { Multiaddr } = require('multiaddr')
const { bureaucracy, createNode } = require('./utils')

module.exports = bureaucracy(async (runenv, client, netclient) => {
  let node

  const states = {
    enrolled: 'enrolled',
    nodeCreated: 'nodeCreated',
    bootstrap: 'bootstrap',
    connected: 'connected',
    done: 'done'
  }

  try {
    // Signal entry to the enrolled state, and obtain a sequence number.
    // We will use this number to know where in the "circle" we are.
    const seq = await client.signalEntry(states.enrolled)
    runenv.recordMessage(`sequence id: ${seq}`)

    node = await createNode()
    runenv.recordMessage(`peer id: ${node.peerId.toString()}`)

    // Wait for all the nodes to be created.
    await client.signalAndWait(states.nodeCreated, runenv.testInstanceCount)

    if (seq === 1) {
      // Bootstrap node: publishes the peerId and multiaddresses.

      await client.publish(states.bootstrap, {
        peerId: node.peerId.toString(),
        multiaddrs: node.multiaddrs.map(ma => ma.toString())
      })
    } else {
      // Other nodes: wait for the bootstrap peerId and multiaddresses and connect.

      const sub = await client.subscribe(states.bootstrap)

      const bootstrapNode = await sub.wait.next()
      sub.cancel()

      let { peerId, multiaddrs } = bootstrapNode.value
      peerId = PeerId.parse(peerId)
      multiaddrs = multiaddrs.map(ma => new Multiaddr(ma))
      runenv.recordMessage(`got bootstrap node: ${JSON.stringify(bootstrapNode)}`)

      // Connect to the neighbour only.
      node.peerStore.addressBook.set(peerId, multiaddrs)
      await node.dial(peerId)
      runenv.recordMessage('dialed bootstrap node')

      // The DHT routing tables need a moment to populate
      await delay(100)

      // Wait for all peers to have dialed the bootstrap node.
      await client.signalAndWait(states.connected, runenv.testInstanceCount - 1)
    }

    // Wait for all the nodes before exiting.
    await client.signalAndWait(states.done, runenv.testInstanceCount)
  } finally {
    runenv.recordMessage('stopping node')
    if (node) {
      // TODO: this hangs, leading to a failures due to exceeded deadlines.
      await node.stop()
    }
    runenv.recordMessage('stopping node')
  }
})
