export default class NetworkingEvents extends EventTarget {
  constructor (datPeers, userId, version, networkType) {
    super()
    this.datPeers = datPeers
    this.userId = userId
    this.version = version
    this.networkType = networkType || 'janus'
    this.rooms = new Set()

    this.onMessage = this.onMessage.bind(this)
  }

  send (data) {
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
    this.sendLogon()
  }

  reconnect () {
    this.sendLogon()
  }

  disconnect () {
    this.datPeers.removeEventListener('message', this.onMessage)
    this.datPeers.setSessionData({})
  }

  onMessage ({ peer, message }) {
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
    this.roomId = roomId

    this.sendLogon()

    const method = 'user_enter'
    const { userId } = this
    const data = { userId, roomId }
    this.send({ method, data })
  }

  leave_room (roomId) {
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
