class NetworkingEvents extends EventTarget {
  constructor (datPeers, userId, version, networkType) {
    super()
    this.datPeers = datPeers
    this.userId = userId
    this.version = version
    this.networkType = networkType || 'janus'
    this.rooms = new Set()

    this.onMessage = this.onMessage.bind(this)
    this.onConnect = this.onConnect.bind(this)
    this.onDisconnect = this.onDisconnect.bind(this)
  }

  send (data) {
    // console.log('Sending data', data)
    this.datPeers.broadcast({ type: this.networkType, data })
  }

  dispatchMessage (detail) {
    const event = new CustomEvent('message', {
      detail
    })
    event.data = detail

    this.dispatchEvent(event)
  }

  async connect () {
    this.datPeers.addEventListener('message', this.onMessage)
    this.datPeers.addEventListener('connect', this.onConnect)
    this.datPeers.addEventListener('disconnect', this.onDisconnect)
    await this.sendLogon()
  }

  reconnect () {
    this.sendLogon()
  }

  disconnect () {
    this.datPeers.removeEventListener('message', this.onMessage)
    this.datPeers.removeEventListener('connect', this.onConnect)
    this.datPeers.removeEventListener('disconnect', this.onDisconnect)
    this.datPeers.setSessionData({})
  }

  onConnect ({ peer }) {
    // console.log('Connected user', peer)

    const { userId, roomId } = this

    // Don't send if you haven't entered a room yet
    if (!roomId) return

    // Send them a user_enter event for our current room
    const method = 'user_enter'
    const data = { userId, roomId }
    peer.send({ type: this.networkType, data: { method, data } })
  }

  onDisconnect ({peer}) {
    // console.log('Disconnected user', peer)

    const {sessionData} = peer
    if(!sessionData) return

    const { userId, roomId } = sessionData

    // Don't send if you haven't entered a room yet
    if (!roomId) return

    // Send them a user_enter event for our current room
    const method = 'user_leave'
    const data = { userId, roomId }
    peer.send({ type: this.networkType, data: { method, data } })
  }

  onMessage ({ peer, message }) {
    // console.log('Got data', peer, message)
    const { type, data } = message

    // Ignore messages that aren't for this network type
    if (type !== this.networkType) return

    const { sessionData } = peer

    // Ignore messages from users without session data
    if (!sessionData) return

    // Ignore messages from users on a different network type
    if (sessionData.type !== this.networkType) return

    this.dispatchMessage(data)
  }

  sendLogon () {
    const { userId, roomId, version } = this
    const type = this.networkType
    const data = { type, userId, roomId, version }
    this.datPeers.setSessionData(data)
  }

  async listUsers () {
    const peers = await this.datPeers.list()

    const users = peers.filter(({ sessionData }) => {
      const { type } = sessionData
      return type === this.networkType
    }).map(({ sessionData }) => {
      return sessionData.userId
    })

    const method = 'users_online'
    const data = { users }

    this.dispatchMessage({
      method,
      data
    })
  }

  setUserId (userId) {
    this.userId = userId
    this.sendLogon()
  }

  subscribe (roomId) {
    this.rooms.add(roomId)
  }

  unsubscribe (roomId) {
    this.rooms.delete(roomId)
  }

  enter_room (roomId) {
    this.subscribe(roomId)
    this.roomId = roomId

    this.sendLogon()

    const method = 'user_enter'
    const { userId } = this
    const data = { userId, roomId }
    this.send({ method, data })
  }

  leave_room (roomId) {
    this.unsubscribe(roomId)
    if (this.roomId === roomId) {
      this.roomId = null
      this.sendLogon()
    }

    const method = 'user_leave'
    const { userId } = this
    const data = { userId, roomId }
    this.send({ method, data })
  }

  move (position) {
    const method = 'user_moved'
    const { userId, roomId } = this
    const data = { userId, roomId, position }
    this.send({ method, data })
  }

  chat (message) {
    const method = 'user_chat'
    const { userId, roomId } = this
    const data = { userId, roomId, message }
    this.send({ method, data })
  }
}

AFRAME.registerComponent('dat-networked-scene', {
  schema: {
    app: { default: 'default' },
    template: { type: 'string' },
    container: { default: 'a-scene' }
  },

  init: function () {
    const version = '0'

    const userId = prompt('What is your name?')

    const networkType = this.data.app

    const datPeers = window.experimental.datPeers

    this.network = new NetworkingEvents(
      datPeers,
      userId,
      version,
      networkType
    )

    this.network.connect()

    this.connected = true
    this.el.emit('network-connected', this.network)

    this.onMessage = this.onMessage.bind(this)

    this.network.addEventListener('message', this.onMessage)
  },

  onMessage ({ detail }) {
    const { method, data } = detail

    const emitEvent = `network-${method}`

    console.log('Emitting', emitEvent, this.el)
    this.el.emit(emitEvent, data)
    if (data.userId) {
      this.el.emit(`network-${data.userId}-${method}`, data)
    }

    if (method === 'user_enter') {
      const templateSelector = this.data.template
      if (!templateSelector) return console.error('Cannot create user entity without a template')
      const { userId, roomId } = data

      const ownRoom = this.network.roomId

      // Ignore events from rooms we're not in
      if(ownRoom !== roomId) return console.error('Ignoring user enter from', roomId, ownRoom)

      const exists = document.getElementById(userId)
      if (exists) return console.error('User ID already exists')

      this.network.enter_room(roomId)

      const template = document.querySelector(templateSelector)

      const entity = document.importNode(template.content, true).firstElementChild

      console.log('Created entity', entity)

      entity.setAttribute('id', userId)
      entity.setAttribute('dat-networked-remote', '')

      const container = document.querySelector(this.data.container) || this.el

      container.appendChild(entity)
    } else if (method === 'user_leave') {
      const { userId } = data
      const entity = document.getElementById(userId)
      if (entity) entity.destroy()
    }
  },

  remove: function () {
    this.network.removeEventListener('message', this.onMessage)
    this.network.disconnect()
  }
})

AFRAME.registerComponent('dat-networked', {
  schema: {
    room: { default: 'default' }
  },
  init: function () {
    if (this.isSceneReady()) {
      this.enterRoom()
    } else {
      this.el.sceneEl.addEventListener('network-connected', () => {
        this.enterRoom(this.data.room)
      })
    }

    this.lastX = 0
    this.lastY = 0
    this.lastZ = 0
    this.lastRX = 0
    this.lastRY = 0
    this.lastRZ = 0
  },

  enterRoom () {
    const component = this.getNetworkComponent()
    if (!component) return console.log('Unable to enter room')
    component.network.enter_room(this.data.room)
  },

  isSceneReady: function () {
    const component = this.getNetworkComponent()
    if (!component) return false
    return !!component.connected
  },

  getNetworkComponent: function () {
    const scene = this.el.sceneEl
    const networkComponent = scene.components['dat-networked-scene']
    return networkComponent
  },

  sendPosition: function () {
    if (!this.isSceneReady()) return
    const component = this.getNetworkComponent()

    const object = this.el.object3D
    const position = object.position
    const rotation = object.rotation

    const pos = position.toArray()
    const dir = rotation.toArray()
    const view_dir = dir

    component.network.move({ pos, dir, view_dir })
  },

  tick: function () {
    if (!this.isSceneReady()) return console.log('Scene not ready')

    const object = this.el.object3D
    const position = object.position
    const rotation = object.rotation
    const changedPosition = (
      (position.x !== this.lastX) ||
      (position.y !== this.lastY) ||
      (position.z !== this.lastZ)
    )

    let changedRotation = (
      (rotation.x !== this.lastRX) ||
      (rotation.y !== this.lastRY) ||
      (rotation.z !== this.lastRZ)
    )

    this.lastX = position.x
    this.lastY = position.y
    this.lastZ = position.z

    this.lastRX = rotation.x
    this.lastRY = rotation.y
    this.lastRZ = rotation.z

    if (changedRotation || changedPosition) {
      this.sendPosition()
    }
  }
})

AFRAME.registerComponent('dat-networked-remote', {
  init: function () {
    this.onMove = this.onMove.bind(this)

    const net = document.querySelector('[dat-networked-scene]')

    net.addEventListener('network-user_moved', this.onMove)
  },

  onMove ({ detail }) {
    const {userId, roomId, position} = detail
    const ownId = this.el.getAttribute('id')
    if (userId !== ownId) return

    console.log('Move', userId, position)

    const { pos, dir } = position

    this.el.setAttribute("position", pos.slice(0, 3).join(' '))

    const object = this.el.object3D

    object.rotation.fromArray(dir)
  },

  remove: function () {
    // Stop listening for events
    this.sceneEl.removeEventListener('network-user_moved', this.onMove)
  }
})
