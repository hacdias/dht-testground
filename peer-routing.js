const { performance } = require('perf_hooks')
const delay = require('delay')
const PeerId = require('peer-id')
const { Multiaddr } = require('multiaddr')
const { bureaucracy, createNode } = require('./utils')

module.exports = bureaucracy(async (runenv, client, netclient) => {
  let node

  const states = {
    enrolled: 'enrolled',
    nodeCreated: 'nodeCreated',
    addresses: 'addresses',
    connected: 'connected',
    done: 'done'
  }

  if (runenv.testInstanceCount % 2 !== 0) {
    throw new Error('number of total instances must be an even number')
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

    // Calculate the next neighbour's number. We want to connect them in a circle.
    const neighbourSeq = (seq % runenv.testInstanceCount) + 1
    runenv.recordMessage(`${seq} will dial ${neighbourSeq}`)

    // Publish the addresses, peer ids and sequence numbers so other peers can add
    // me to their address book.
    const { sub: { cancel, wait } } = await client.publishSubscribe(states.addresses, {
      seq,
      peerId: node.peerId.toString(),
      multiaddrs: node.multiaddrs.map(ma => ma.toString())
    })

    // Collect the neighbours information.
    const neighbours = new Array(runenv.testInstanceCount)
    let i = 0

    for await (const { seq, peerId, multiaddrs } of wait) {
      neighbours[seq] = {
        peerId: PeerId.parse(peerId),
        multiaddrs: multiaddrs.map(ma => new Multiaddr(ma))
      }

      i++
      if (i === runenv.testInstanceCount) await cancel()
    }

    // Connect to the neighbour only.
    node.peerStore.addressBook.set(
      neighbours[neighbourSeq].peerId,
      neighbours[neighbourSeq].multiaddrs
    )
    await node.dial(neighbours[neighbourSeq].peerId)
    runenv.recordMessage(`dialed: ${neighbours[neighbourSeq].peerId.toString()}`)

    // Wait for all peers to have dialed their neighbour.
    await client.signalAndWait(states.connected, runenv.testInstanceCount)

    // The DHT routing tables need a moment to populate
    await delay(100)

    // Calculate which peer is on the other side of the circle.
    const otherSeq = (seq + runenv.testInstanceCount / 2 - 1) % runenv.testInstanceCount + 1
    runenv.recordMessage(`${seq} will find ${otherSeq}`)

    // Try to find it!
    const start = performance.now()
    const peer = await node.peerRouting.findPeer(neighbours[otherSeq].peerId)
    const end = performance.now()

    // Et voilá!
    runenv.recordMessage(`Found peer: ${peer.id.toString()}, took: ${end - start} ms`)

    // Wait for all the nodes before exiting.
    await client.signalAndWait(states.done, runenv.testInstanceCount)
  } finally {
    // TODO: node hangs while stopping. Adding a delay reduces the likeliness.
    await delay(10000)
    runenv.recordMessage('stopping node')
    if (node) await node.stop()
  }
})
