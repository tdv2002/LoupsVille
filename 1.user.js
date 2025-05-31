// ==UserScript==
// @name         LoupsVille dev
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  wolvesville mod
// @author       bladingpark
// @contributor  sharpedge
// @icon         https://www.google.com/s2/favicons?sz=64&domain=wolvesville.com
// @match        *://*.wolvesville.com/*
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

// Global state
var VERSION = GM_info.script.version
var AUTHTOKENS = {
  idToken: '',
  refreshToken: '',
  'Cf-JWT': '',
}
var PLAYER = undefined
var INVENTORY = undefined
var HISTORY = []
var PLAYERS = []
var ROLE = undefined
var GAME_STATUS = undefined
var IS_CONSOLE_OPEN = false
var GOLD_WHEEL_SPINS_COUNTER = 0
var GOLD_WHEEL_SILVER_SESSION = 0
var TOTAL_XP_SESSION = 0
var TOTAL_UP_LEVEL = 0
var GAME_STARTED_AT = 0
var DOCUMENT_TITLE = undefined
var LV_SETTINGS = {
  DEBUG_MODE: false,
  SHOW_HIDDEN_LVL: true,
  AUTO_REPLAY: false,
  AUTO_PLAY: false,
}
var AUTO_REPLAY_INTERVAL = undefined
var SOCKET = undefined
var REGULARSOCKET = undefined
var GAME_ID = undefined
var SERVER_URL = undefined
var GAME_SETTINGS = undefined

const main = async () => {
  getAuthtokens()
  loadSettings()
  patchLocalStorage()
  injectChat()
  injectSettings()
  injectStyles()
  setInterval(injectChat, 1000)
  fetchInterceptor()
  socketInterceptor(onMessage)
  setInterval(setChatState, 1000)
  setInterval(setDocumentTitle, 1000)
}

const injectSettings = () => {
  $('html').append(lvModal)
  $('.lv-modal-close').on('click', () => {
    $('.lv-modal-popup-container').css({ display: 'none' })
  })
  $('.lv-modal-veil').on('click', () => {
    $('.lv-modal-popup-container').css({ display: 'none' })
  })
  $('.lv-modal-rose-wheel-btn').on('click', () => {
    fetch('https://core.api-wolvesville.com/rewards/goldenWheelSpin', {
      method: 'POST',
      headers: getHeaders(),
    })
  })
  $('.lv-modal-gold-wheel-btn').on('click', () => {
    fetch(`https://core.api-wolvesville.com/rewards/wheelRewardWithSecret/${getRewardSecret()}`, {
      method: 'POST',
      headers: getHeaders(),
    })
  })
  $('.lv-modal-loot-boxes-btn').on('click', () => {
    if (INVENTORY.lootBoxes?.length) lootBox()
  })
  $('.lv-modal-checkbox.debug').on('click', () => {
    LV_SETTINGS.DEBUG_MODE = !LV_SETTINGS.DEBUG_MODE
    $('.lv-modal-checkbox.debug').text(LV_SETTINGS.DEBUG_MODE ? '' : '')
    saveSetting()
  })
  $('.lv-modal-checkbox.show-hidden-lvl').on('click', () => {
    LV_SETTINGS.SHOW_HIDDEN_LVL = !LV_SETTINGS.SHOW_HIDDEN_LVL
    $('.lv-modal-checkbox.show-hidden-lvl').text(LV_SETTINGS.SHOW_HIDDEN_LVL ? '' : '')
    saveSetting()
  })
  $('.lv-modal-checkbox.auto-replay').on('click', () => {
    LV_SETTINGS.AUTO_REPLAY = !LV_SETTINGS.AUTO_REPLAY
    $('.lv-modal-checkbox.auto-replay').text(LV_SETTINGS.AUTO_REPLAY ? '' : '')
    handleAutoReplay()
    saveSetting()
  })
  $('.lv-modal-checkbox.auto-play').on('click', () => {
    LV_SETTINGS.AUTO_PLAY = !LV_SETTINGS.AUTO_PLAY
    $('.lv-modal-checkbox.auto-play').text(LV_SETTINGS.AUTO_PLAY ? '' : '')
    saveSetting()
  })
  $('.lv-modal-checkbox.debug').text(LV_SETTINGS.DEBUG_MODE ? '' : '')
  $('.lv-modal-checkbox.show-hidden-lvl').text(LV_SETTINGS.SHOW_HIDDEN_LVL ? '' : '')
  $('.lv-modal-checkbox.auto-replay').text(LV_SETTINGS.AUTO_REPLAY ? '' : '')
  $('.lv-modal-checkbox.auto-play').text(LV_SETTINGS.AUTO_PLAY ? '' : '')
  handleAutoReplay()
}

const handleAutoReplay = () => {
  if (LV_SETTINGS.AUTO_REPLAY) {
    AUTO_REPLAY_INTERVAL = setInterval(() => {
      $('div:contains("START GAME")').click()
      $('div:contains("Play again")').click()
      $('div:contains("Continue")').click()
      if ($('div:contains("Play again")').length) {
        $('div:contains("OK")').click()
      }
    }, 500)
  } else {
    clearInterval(AUTO_REPLAY_INTERVAL)
  }
}

const saveSetting = () => {
  let settings = {
    DEBUG_MODE: LV_SETTINGS.DEBUG_MODE,
    SHOW_HIDDEN_LVL: LV_SETTINGS.SHOW_HIDDEN_LVL,
    AUTO_REPLAY: LV_SETTINGS.AUTO_REPLAY,
    AUTO_PLAY: LV_SETTINGS.AUTO_PLAY,
  }
  localStorage.setItem('lv-settings', JSON.stringify(settings))
}

const log = (m) => {
  if (LV_SETTINGS.DEBUG_MODE) console.log(m)
}

const loadSettings = () => {
  const settings = localStorage.getItem('lv-settings')
  if (settings) {
    LV_SETTINGS = JSON.parse(settings)
  } else {
    saveSetting()
  }
  log(LV_SETTINGS)
}

const delay = (time = 500) =>
  new Promise((r) => {
    setTimeout(r, time)
  })

const lootBox = async (c = 0) => {
  if (c === 40) {
    addChatMsg(`⏳ wait 1 min before opening again`)
    await delay(1000 * 60 * 1)
    c = 0
  }
  await fetch(`https://core.api-wolvesville.com/inventory/lootBoxes/${INVENTORY.lootBoxes[0].id}`, {
    method: 'POST',
    headers: getHeaders(),
  }).then((rep) => {
    if (rep.status === 200) {
      INVENTORY.lootBoxes.shift()
      $('.lv-modal-loot-boxes-status').text(`(${INVENTORY.lootBoxes.length} 🎁 available)`)
      if (INVENTORY.lootBoxes.length) {
        return lootBox(c + 1)
      }
    }
  })
}

const setDocumentTitle = () => {
  document.title = DOCUMENT_TITLE || `🔥 LoupsVille v${VERSION}`
}

const getRole = (id) => {
  return JSON.parse(localStorage.getItem('roles-meta-data')).roles[id]
}

const setRole = (id) => {
  ROLE = getRole(id)
}

const getAuthtokens = () => {
  const authtokens = JSON.parse(localStorage.getItem('authtokens'))
  log(authtokens)
  if (authtokens) {
    AUTHTOKENS.idToken = authtokens.idToken || ''
    AUTHTOKENS.refreshToken = authtokens.refreshToken || ''
  }
}

const requestsToCatch = {
  'https://auth.api-wolvesville.com/players/signUpWithEmailAndPassword': (data) => {
    if (data?.idToken) {
      AUTHTOKENS.idToken = data.idToken
      AUTHTOKENS.refreshToken = data.refreshToken
    }
  },
  'https://auth.api-wolvesville.com/players/createIdToken': (data) => {
    if (data?.idToken) {
      AUTHTOKENS.idToken = data.idToken
      AUTHTOKENS.refreshToken = data.refreshToken
    }
  },
  'https://auth.api-wolvesville.com/cloudflareTurnstile/verify': (data) => {
    if (data?.jwt) {
      AUTHTOKENS['Cf-JWT'] = data.jwt || ''
      addChatMsg('🛡️ Cloudflare token intercepted')
    }
  },
  'https://core.api-wolvesville.com/players/meAndCheckAppVersion': (data) => {
    if (data?.player) {
      const { username, level } = data.player
      !PLAYER && addChatMsg(`👋 ${username} (lvl ${level})`)
      PLAYER = data.player
    }
  },
  'https://core.api-wolvesville.com/inventory/lootBoxes/': (data) => {
    if (data?.items?.length) {
      let silver = 0
      let loots = []
      data.items.forEach((item) => {
        loots.push(item.type)
        if (item.duplicateItemCompensationInSilver) {
          silver += item.duplicateItemCompensationInSilver
        } else if (item.type === 'SILVER_PILE') {
          silver += item.silverPile.silverCount
        }
      })
      INVENTORY.silverCount += silver
      addChatMsg(`🎁 ${loots.join(', ')} and 🪙${silver}`)
    }
  },
  'https://core.api-wolvesville.com/inventory?': (data, url) => {
    if (data?.silverCount) {
      INVENTORY = data
    }
    if (data?.lootBoxes !== undefined) {
      const { lootBoxes } = data
      if (lootBoxes.length) {
        const cardBoxes = lootBoxes.filter((v) => v.event === 'LEVEL_UP_CARD').length
        const tmp = cardBoxes ? `(including ${cardBoxes} role cards)` : ''
        addChatMsg(`🎁 ${lootBoxes.length} boxes available ${tmp}`)
      }
      $('.lv-modal-loot-boxes-status').text(`(${lootBoxes.length} 🎁 available)`)
    }
    // return new Response(JSON.stringify({ ...data, loyaltyTokenCount: 9999,  }))
  },
  'https://game.api-wolvesville.com/api/public/game/running': (data) => {
    return new Response(JSON.stringify({ running: false }))
  },
  'https://core.api-wolvesville.com/rewards/goldenWheelSpin': (data) => {
    if (data?.length) {
      const winner = data.find((v) => v.winner)
      if (winner) {
        const tmp = winner.silver > 0 ? `🪙${winner.silver}` : winner.type
        addChatMsg(`${tmp} looted from 🌹 wheel`)
        INVENTORY.silverCount += winner.silver
        INVENTORY.roseCount -= 30
        setChatState()
      }
    }
  },
  'https://core.api-wolvesville.com/rewards/wheelRewardWithSecret/': (data) => {
    if (data?.code) {
      addChatMsg(`Error: You probably hit the spins limit for today ${JSON.stringify(data)}`, true, 'color: #ff603b;')
      $('.lv-modal-gold-wheel-status').text(`Unavailable`).css({ color: '#ff603b' })
    } else if (data?.length) {
      const winner = data.find((v) => v.winner)
      if (winner) {
        const tmp = winner.silver > 0 ? `🪙${winner.silver}` : winner.type
        INVENTORY.silverCount += winner.silver
        GOLD_WHEEL_SPINS_COUNTER += 1
        GOLD_WHEEL_SILVER_SESSION += winner.silver
        PLAYER.silverCount += winner.silver
        addChatMsg(
          `#${GOLD_WHEEL_SPINS_COUNTER}: ${tmp} looted from 🪙 wheel (session: 🪙${GOLD_WHEEL_SILVER_SESSION})`
        )
        setChatState()
      }
    }
  },
  'https://core.api-wolvesville.com/rewards/wheelItems/v2': (data) => {
    if (data.nextRewardAvailableTime) {
      $('.lv-modal-gold-wheel-status')
        .text(
          `Unavailable until ${new Date(data.nextRewardAvailableTime).toLocaleString('en-US', {
            timeZoneName: 'short',
          })}`
        )
        .css({ color: '#ff603b' })
    } else {
      $('.lv-modal-gold-wheel-status').text(`Available`).css({ color: '#67c23a' })
    }
  },
}

const fetchInterceptor = () => {
  const { fetch: origFetch } = window
  window.fetch = async (...args) => {
    const url = args[0]
    if (url.startsWith('https://core.api-wolvesville.com/inventory?')) {
      args[0] = 'https://core.api-wolvesville.com/inventory?'
    }
    const catchMethod = requestsToCatch[Object.keys(requestsToCatch).find((_url) => url.startsWith(_url))]
    if (!!catchMethod) {
      log('fetch called with args:', args)
      const response = await origFetch(...args)
      const mockedReponse = await response
        .clone()
        .json()
        .then((data) => {
          log('intercepted response data:', data)
          return catchMethod(data)
        })
      if (mockedReponse) log(mockedReponse, response)
      return mockedReponse || response
    } else {
      return origFetch(...args)
    }
  }
}

function socketInterceptor(fn) {
  fn = fn || log
  let property = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')
  const data = property.get
  function lookAtMessage() {
    let socket = this.currentTarget instanceof WebSocket
    if (!socket) return data.call(this)
    let msg = data.call(this)
    Object.defineProperty(this, 'data', { value: msg })
    fn({ data: msg, socket: this.currentTarget, event: this })
    return msg
  }
  property.get = lookAtMessage
  Object.defineProperty(MessageEvent.prototype, 'data', property)
}

const onMessage = (message) => {
  const messageId = message.data.slice(0, 2)
  if (messageId === '42') {
    const parsedMessage = messageParser(message.data)
    log(parsedMessage)
    if (parsedMessage?.length) {
      messageDispatcher(parsedMessage)
    }
  }
}
const connectRegularSocket = () => {
  const url = `wss://${SERVER_URL.replace('https://', '')}/`
  REGULARSOCKET = io(url, {
    query: {
      firebaseToken: AUTHTOKENS.idToken,
      gameId: GAME_ID,
      reconnect: true,
      ids: 1,
      'Cf-JWT': AUTHTOKENS['Cf-JWT'],
      apiV: 1,
      EIO: 4,
    },
    transports: ['websocket'],
  })

  REGULARSOCKET.on('disconnect', () => {
    addChatMsg('🤖 Parallel socket disconnected')
    REGULARSOCKET = undefined
  })
  REGULARSOCKET.on('game-joined', () => {
    addChatMsg('🤖 Parallel socket connected')
  })

  REGULARSOCKET.on('game-over-awards-available', (_data) => {
    const data = JSON.parse(_data)
    if (data.playerAward.canClaimDoubleXp) {
      REGULARSOCKET.emit('game-over-double-xp')
      addChatMsg('Claim double xp', true, 'color:rgb(17, 255, 0);')
    } else {
      TOTAL_XP_SESSION += data.playerAward.awardedTotalXp
      addChatMsg(`🧪 ${data.playerAward.awardedTotalXp} xp`)
      if (data.playerAward.awardedLevels) {
        PLAYER.level += data.playerAward.awardedLevels
        TOTAL_UP_LEVEL += data.playerAward.awardedLevels
        log(`🆙 ${PLAYER.level}`)
      }
      setTimeout(() => {
        REGULARSOCKET.disconnect()
      }, 500)
    }
  })
  REGULARSOCKET.onAny((...args) => {
    log(args)
  })
}

const connectSocket = () => {
  var LOVERS = []
  var DEADS = []
  var JW_TARGET = undefined
  var CHAT_WW_SENDED = false
  var WOLVES = []
  var TARGET_WW_VOTE = undefined
  const url = `wss://${SERVER_URL.replace('https://', '')}/`
  SOCKET = io(url, {
    query: {
      firebaseToken: AUTHTOKENS.idToken,
      gameId: GAME_ID,
      reconnect: true,
      ids: 1,
      'Cf-JWT': AUTHTOKENS['Cf-JWT'],
      apiV: 1,
      EIO: 4,
    },
    transports: ['websocket'],
  })
  SOCKET.on('disconnect', () => {
    addChatMsg('🤖 Parallel socket disconnected')
    SOCKET = undefined
  })
  SOCKET.on('game-joined', () => {
    addChatMsg('🤖 Parallel socket connected')
  })
  SOCKET.on('game-players-killed', (_data) => {
    const data = JSON.parse(_data)
    data['victims'].forEach((victim) => {
      const player = PLAYERS.find((v) => v.id === victim.targetPlayerId)
      if (player) {
        if (player) DEADS.push(player.id)
        addChatMsg(
          `☠️ ${parseInt(player.gridIdx) + 1}. ${player.username} (${victim.targetPlayerRole}) by ${victim.cause}`
        )
      }
    })
  })
  SOCKET.on('game-cupid-lover-ids-and-roles', (_data) => {
    const data = JSON.parse(_data)
    if (PLAYER && ROLE) {
      const loverPlayerIds = data.loverPlayerIds.filter((v) => v !== PLAYER.id)
      const loverRoles = data.loverRoles.filter((v) => v !== ROLE.id)
      LOVERS = loverPlayerIds.map((playerId, i) => ({ id: playerId, role: loverRoles[i] }))
      if (LOVERS.length === 1) {
        const lover1 = PLAYERS.find((v) => v.id === LOVERS[0].id)
        addChatMsg(`💘 Your lover is ${lover1.gridIdx + 1}. ${lover1.username} (${LOVERS[0].role})`)
      } else if (LOVERS.length === 2) {
        const lover1 = PLAYERS.find((v) => v.id === LOVERS[0].id)
        const lover2 = PLAYERS.find((v) => v.id === LOVERS[1].id)
        addChatMsg(
          `💘 Your lovers are ${lover1.gridIdx + 1}. ${lover1.username} (${LOVERS[0].role}) and ${
            lover2.gridIdx + 1
          }. ${lover2.username} (${LOVERS[1].role})`
        )
      }
    }
  })
  SOCKET.on('game-night-started', () => {
    setTimeout(() => {
      if (ROLE && ROLE.team === 'WEREWOLF') {
        const lover = LOVERS.find((v) => getRole(v.role).team !== 'WEREWOLF')
        if (lover) {
          const targetPlayer = PLAYERS.find((v) => v.id === lover.id)
          if (targetPlayer) {
            addChatMsg(`👉 Vote ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
          }
          TARGET_WW_VOTE = lover.id
          SOCKET.emit('game-werewolves-vote-set', JSON.stringify({ targetPlayerId: lover.id }))
        }
      }
    }, 1000)
  })
  SOCKET.on('game-werewolves-set-roles', (_data) => {
    const data = JSON.parse(_data)
    WOLVES = Object.entries(data.werewolves).map(([id, role]) => ({ id, role }))
    if (
      !CHAT_WW_SENDED &&
      LOVERS.length &&
      WOLVES.length &&
      ROLE.team === 'WEREWOLF' &&
      ROLE.id === 'junior-werewolf' &&
      LOVERS.find((v) => getRole(v.role).team !== 'WEREWOLF')
    ) {
      CHAT_WW_SENDED = true
      setTimeout(() => {
        SOCKET.emit('game:chat-werewolves:msg', JSON.stringify({ msg: `Who?` }))
      }, 2000)
    }
  })
  SOCKET.on('game:chat-werewolves:msg', (_data) => {
    const data = JSON.parse(_data)
    // Case wolf: answer when someone write Who?
    if (
      ROLE &&
      ROLE.team === 'WEREWOLF' &&
      data.authorId !== PLAYER.id &&
      data.msg &&
      data.msg.toLowerCase().includes('who')
    ) {
      const lover = PLAYERS.find((v) => v.id === LOVERS[0].id)
      if (lover) {
        setTimeout(() => {
          SOCKET.emit('game:chat-werewolves:msg', JSON.stringify({ msg: `${lover.gridIdx + 1}` }))
        }, 1000)
      }
    }
    // Case you are junior: extract grid number from chat
    if (ROLE && ROLE.id === 'junior-werewolf' && data.msg && data.authorId !== PLAYER.id) {
      const numbers = data.msg.match(/\d+/)
      if (numbers && numbers.length) {
        const gridIdx = parseInt(numbers[0])
        const targetPlayer = PLAYERS.find((v) => v.gridIdx + 1 === gridIdx)
        if (targetPlayer) {
          JW_TARGET = targetPlayer.id
          addChatMsg(`🐾 Select ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
          SOCKET.emit('game-junior-werewolf-selected-player', JSON.stringify({ targetPlayerId: targetPlayer.id }))
        }
      }
    }
  })
  SOCKET.on('game-werewolves-vote-set', (_data) => {
    const data = JSON.parse(_data)
    if (data.playerId === PLAYER.ID) return
    if (!JW_TARGET && ROLE && ROLE.id === 'junior-werewolf' && data.playerId !== PLAYER.id) {
      JW_TARGET = data.targetPlayerId
      const targetPlayer = PLAYERS.find((v) => v.id === data.targetPlayerId)
      if (targetPlayer) {
        addChatMsg(`🐾 Select ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
      }
      SOCKET.emit('game-junior-werewolf-selected-player', JSON.stringify({ targetPlayerId: data.targetPlayerId }))
    }
    // Case your teammate is junior wolf and you're not
    if (
      ROLE &&
      ROLE.id !== 'junior-werewolf' &&
      WOLVES.find((v) => v.role === 'junior-werewolf' && v.id === data.playerId)
    ) {
      const targetPlayer = PLAYERS.find((v) => v.id === data.targetPlayerId)
      setTimeout(() => {
        if (targetPlayer) {
          addChatMsg(`👉 Vote ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
        }
        if (TARGET_WW_VOTE !== data.targetPlayerId) {
          TARGET_WW_VOTE = data.targetPlayerId
          SOCKET.emit('game-werewolves-vote-set', JSON.stringify({ targetPlayerId: data.targetPlayerId }))
        }
      }, 1000)
    } else if (
      ROLE &&
      ROLE.id !== 'junior-werewolf' &&
      !WOLVES.find((v) => v.role === 'junior-werewolf' && v.id === data.playerId) &&
      LOVERS.find((v) => ['priest', 'vigilante', 'gunner'].includes(v.role))
    ) {
      // Case your lover is priest | vigilante | gunner: vote for your teammate lover
      const targetPlayer = PLAYERS.find((v) => v.id === data.targetPlayerId)
      setTimeout(() => {
        if (targetPlayer) {
          addChatMsg(`👉 Vote ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
        }
        if (TARGET_WW_VOTE !== data.targetPlayerId) {
          TARGET_WW_VOTE = data.targetPlayerId
          SOCKET.emit('game-werewolves-vote-set', JSON.stringify({ targetPlayerId: data.targetPlayerId }))
        }
      }, 1000)
    }
  })
  SOCKET.on('game-day-voting-started', () => {
    if (PLAYER && !DEADS.includes(PLAYER.id)) {
      const wwLover = LOVERS.find((v) => getRole(v.role).team === 'WEREWOLF')
      if (wwLover) {
        if (ROLE && ROLE.team === 'WEREWOLF') {
          SOCKET.emit('game:chat-public:msg', JSON.stringify({ msg: 'wc' }))
        }
        const targetPlayer = PLAYERS.find((v) => v.id === wwLover.id)
        if (targetPlayer) {
          addChatMsg(`👉 Vote ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
        }
        SOCKET.emit('game-day-vote-set', JSON.stringify({ targetPlayerId: wwLover.id }))
      } else if (ROLE && ROLE.team === 'WEREWOLF') {
        SOCKET.emit('game:chat-public:msg', JSON.stringify({ msg: 'me' }))
      } else if (
        ROLE &&
        [
          'serial-killer',
          'arsonist',
          'corruptor',
          'bandit',
          'cannibal',
          'evil-detective',
          'bomber',
          'alchemist',
          'siren',
          'illusionist',
          'blight',
          'sect-leader',
          'zombie',
        ].includes(ROLE.id)
      ) {
        SOCKET.emit('game:chat-public:msg', JSON.stringify({ msg: 'solo' }))
      }
    }
  })
  // Case nobody vote the wolf, and someone writes "me"
  SOCKET.on('game:chat-public:msg', (_data) => {
    const data = JSON.parse(_data)
    if (
      PLAYER &&
      !DEADS.includes(PLAYER.id) &&
      data.authorId !== PLAYER.id &&
      data.msg &&
      ROLE &&
      ROLE.team === 'VILLAGER' &&
      ['Me', 'me', 'ME', 'm', 'M', 'wc', 'Wc', 'WC'].includes(data.msg)
    ) {
      const targetPlayer = PLAYERS.find((v) => v.id === data.authorId)
      if (targetPlayer) {
        addChatMsg(`👉 Vote ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
      }
    }
  })
  SOCKET.on('game-day-vote-set', (_data) => {
    const data = JSON.parse(_data)
    if (PLAYER && !DEADS.includes(PLAYER.id)) {
      const targetPlayer = PLAYERS.find((v) => v.id === data.targetPlayerId)
      if (ROLE && ROLE.id === 'priest') {
        setTimeout(() => {
          if (targetPlayer) addChatMsg(`💦 Kill ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
          SOCKET.emit('game-priest-kill-player', JSON.stringify({ targetPlayerId: data.targetPlayerId }))
        }, 1000)
      } else if (ROLE && ROLE.id === 'vigilante') {
        setTimeout(() => {
          if (targetPlayer) addChatMsg(`🔫 Kill ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
          SOCKET.emit('game-vigilante-shoot', JSON.stringify({ targetPlayerId: data.targetPlayerId }))
        }, 1000)
      } else if (ROLE && ROLE.id === 'gunner') {
        setTimeout(() => {
          if (targetPlayer) addChatMsg(`🔫 Kill ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`)
          SOCKET.emit('game-gunner-shoot-player', JSON.stringify({ targetPlayerId: data.targetPlayerId }))
        }, 1000)
      }
    }
  })
  SOCKET.on('game-reconnect-set-players', (_data) => {
    const data = JSON.parse(_data)
    Object.values(data).forEach((player) => {
      if (!player.isAlive) {
        DEADS.push(player.id)
      }
    })
  })
  SOCKET.on('game-over-awards-available', (_data) => {
    const data = JSON.parse(_data)
    if (data.playerAward.canClaimDoubleXp) {
      SOCKET.emit('game-over-double-xp')
      addChatMsg('Claim double xp', true, 'color:rgb(17, 255, 0);')
    } else {
      TOTAL_XP_SESSION += data.playerAward.awardedTotalXp
      addChatMsg(`🧪 ${data.playerAward.awardedTotalXp} xp`)
      if (data.playerAward.awardedLevels) {
        PLAYER.level += data.playerAward.awardedLevels
        TOTAL_UP_LEVEL += data.playerAward.awardedLevels
        log(`🆙 ${PLAYER.level}`)
      }
      setTimeout(() => {
        SOCKET.disconnect()
      }, 500)
    }
  })
  SOCKET.onAny((...args) => {
    log(args)
  })
}

const messagesToCatch = {
  'game-joined': (data) => {
    if (SOCKET || REGULARSOCKET) return
    addChatMsg('🔗 Game joined')
    DOCUMENT_TITLE = '🔗 Game joined'
    const _data = Object.values(data)
    GAME_ID = _data[0]
    SERVER_URL = _data[1]
    setTimeout(setPlayersLevel, 1000)
  },
  'game-settings-changed': (data) => {
    GAME_SETTINGS = data
  },
  'game-starting': () => {
    if (SOCKET || REGULARSOCKET) return
    addChatMsg('🚩 Game starting')
    DOCUMENT_TITLE = '🚩 Game starting'
    GAME_STATUS = 'starting'
  },
  'game-started': (data) => {
    if (SOCKET || REGULARSOCKET) return
    addChatMsg('🚀 Game started')
    DOCUMENT_TITLE = '🚀 Game started'
    GAME_STATUS = 'started'
    GAME_STARTED_AT = new Date().getTime()
    setRole(data.role)
    addChatMsg(`You are ${ROLE.name} (${ROLE.id})`, true, 'color: #FF4081;')
    DOCUMENT_TITLE = `⌛ ${ROLE.name}`
    PLAYERS = data.players
    setTimeout(setPlayersLevel, 1000)
    setTimeout(() => {
      if (
        !SOCKET &&
        LV_SETTINGS.AUTO_PLAY &&
        GAME_SETTINGS.gameMode === 'custom' &&
        GAME_SETTINGS.allCoupled &&
        GAME_ID &&
        SERVER_URL
      ) {
        connectSocket()
      }
      if(!REGULARSOCKET && !(GAME_SETTINGS.gameMode === 'custom') && GAME_ID && SERVER_URL){
        connectRegularSocket()
      }
    }, 1000)
  },
  'player-joined-and-equipped-items': (data) => {},
  'game-set-game-status': (data) => {},
  'game-reconnect-set-game-status': (data) => {
    setTimeout(() => {
      if (
        !SOCKET &&
        LV_SETTINGS.AUTO_PLAY &&
        GAME_SETTINGS.gameMode === 'custom' &&
        GAME_SETTINGS.allCoupled &&
        GAME_ID &&
        SERVER_URL
      ) {
        connectSocket()
      }
      if(!REGULARSOCKET && !(GAME_SETTINGS.gameMode === 'custom') && GAME_ID && SERVER_URL){
        connectRegularSocket()
      }
    }, 1000)
  },
  'players-and-equipped-items': (data) => {
    if (GAME_STATUS === 'started') {
      PLAYERS = data.players
      setTimeout(setPlayersLevel, 1000)
    }
  },
  'game-reconnect-set-players': (data) => {
    if (SOCKET || REGULARSOCKET) return
    PLAYERS = Object.values(data)
    setTimeout(setPlayersLevel, 1000)
    if (PLAYER) {
      const tmp = PLAYERS.find((v) => v.username === PLAYER.username)
      if (tmp) {
        if (tmp.spectate) {
          DOCUMENT_TITLE = `🚀 Spectator`
          addChatMsg(`You are Spectator`, true, 'color: #FF4081;')
        } else if (ROLE) {
          setRole(tmp.role)
          DOCUMENT_TITLE = `🚀 ${tmp.gridIdx + 1}. ${ROLE.name}`
          addChatMsg(`You are ${ROLE.name} (${ROLE.id})`, true, 'color: #FF4081;')
        }
      }
    }
  },
  'game-night-started': () => {
    const tmp = PLAYERS.find((v) => v.id === PLAYER.id)
    if (tmp && ROLE) DOCUMENT_TITLE = `🚀 ${tmp.gridIdx + 1}. ${ROLE.name}`
    setTimeout(setPlayersLevel, 1000)
  },
  'game-players-killed': (data) => {
    if (SOCKET || REGULARSOCKET) return
    data['victims'].forEach((victim) => {
      const player = PLAYERS.find((v) => v.id === victim.targetPlayerId)
      if (player) {
        addChatMsg(
          `☠️ ${parseInt(player.gridIdx) + 1}. ${player.username} (${victim.targetPlayerRole}) by ${victim.cause}`
        )
      }
    })
  },
  'game-game-over': () => {
    if (GAME_STATUS === 'over') return
    GAME_STATUS = 'over'
    let tmp = `🏁 Game over`
    if (GAME_STARTED_AT) {
      const gameDuration = new Date().getTime() - GAME_STARTED_AT
      tmp += ` (${(gameDuration / 1000).toFixed(0)}s)`
      GAME_STARTED_AT = 0
    }
    DOCUMENT_TITLE = tmp
    addChatMsg(tmp)
  },
  'game-over-awards-available': (data) => {
    if (SOCKET || REGULARSOCKET) return
    TOTAL_XP_SESSION += data.playerAward.awardedTotalXp
    addChatMsg(`🧪 ${data.playerAward.awardedTotalXp} xp`)
    if (data.playerAward.awardedLevels) {
      PLAYER.level += data.playerAward.awardedLevels
      TOTAL_UP_LEVEL += data.playerAward.awardedLevels
      log(`🆙 ${PLAYER.level}`)
    }
  },
  disconnect: () => {
    ROLE = undefined
    PLAYERS = []
    GAME_ID = undefined
    SERVER_URL = undefined
    GAME_SETTINGS = undefined
    setTimeout(() => {
      if (SOCKET) SOCKET.disconnect()
      if (REGULARSOCKET) REGULARSOCKET.disconnect()
    }, 1000)
  },
}

const messageDispatcher = (message) => {
  const msg = message[0]
  const data = message.length > 1 ? message[1] : null
  const method = messagesToCatch[msg]
  !!method && method(data)
}

function setPlayersLevel() {
  if (!LV_SETTINGS.SHOW_HIDDEN_LVL) return
  PLAYERS.forEach((player) => {
    const str = `${parseInt(player.gridIdx) + 1} ${player.username}`
    const el = $(`div:contains("${str}")`)
    const gridIdx = parseInt(player.gridIdx) + 1
    const username = player.username
    const level = player.level
    let clanTag = ''
    if (player.clanTag) clanTag = `${player.clanTag}`
    let newUsername = `${gridIdx} ${username} [${level}] ${clanTag}`
    if (el.length) {
      el[el.length - 1].innerHTML = newUsername
      el[el.length - 1].className = 'lv-username'
      el[el.length - 1].parentElement.className = 'lv-username-box'
    }
  })
}

const addChatEvents = () => {
  $('.lv-chat-toggle').on('click', () => {
    IS_CONSOLE_OPEN = !IS_CONSOLE_OPEN
    onToggleChat()
  })
  $('.lv-chat-settings').on('click', () => {
    $('.lv-modal-popup-container').css({ display: 'block' })
  })
}

function injectChat() {
  const lvChat = $('.lv-chat')
  const gameChat = $('div[style="flex: 1 1 0%; margin-top: 16px;"]')
  const endScreen = $(
    'div[style="font-size: 28px; color: rgba(255, 255, 255, 0.87); font-family: FontAwesome6_Pro_Solid; font-weight: normal; font-style: normal;"]'
  )
  if (!lvChat.length) {
    $('html').append(lvChatEl)
    onToggleChat()
    addChatEvents()
    injectHistory()
  } else {
    if (!endScreen.length && gameChat.length) {
      if (!lvChat.hasClass('game')) {
        lvChat.appendTo(gameChat)
        lvChat.removeClass().addClass('lv-chat game')
        scrollToBottom()
      }
    } else {
      if (!lvChat.hasClass('abs')) {
        lvChat.appendTo('html')
        lvChat.removeClass().addClass('lv-chat abs')
        scrollToBottom()
      }
    }
  }
}

function addChatMsg(message, strong = false, style = '') {
  log(`[LoupsVille] ${message}`)
  if (strong) message = `<strong>${message}</strong>`
  const content = `[${formatTime(new Date(Date.now()))}] ${message}`
  const inner = `<div class="lv-chat-msg" style="${style}">${content}</div>`
  HISTORY.push(inner)
  $('.lv-chat-container').append(inner)
  scrollToBottom()
}

function addOldChatMsg(inner) {
  $('.lv-chat-container').append(inner)
  scrollToBottom()
}

function injectHistory() {
  const lvChat = $('.lv-chat')
  const lvChatMsg = $('.lv-chat-msg')
  if (!lvChat.length) return
  if (HISTORY.length) {
    if (!lvChatMsg.length) HISTORY.forEach(addOldChatMsg)
  } else {
    addChatMsg(`🔥 LoupsVille v${VERSION} injected !`, true, 'color: #ffe31f;')
  }
}

function injectStyles() {
  $('html').append(lvStyles)
  $('html').append('<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.8.1/socket.io.js"></script>')
}

function messageParser(message) {
  let tmp = message.slice(2)
  tmp = tmp.replaceAll('"{', '{')
  tmp = tmp.replaceAll('}"', '}')
  tmp = tmp.replaceAll('\\"', '"')
  let parsedMessage = undefined
  try {
    parsedMessage = JSON.parse(tmp)
  } catch {
    // console.error('[LoupsVille] Error parsing message: ', message)
  }
  return parsedMessage
}

function formatTime(d) {
  const HH = d.getHours().toString().padStart(2, '0')
  const MM = d.getMinutes().toString().padStart(2, '0')
  const SS = d.getSeconds().toString().padStart(2, '0')
  const mmm = d.getMilliseconds().toString().padStart(3, '0')
  return `${HH}:${MM}:${SS}.${mmm}`
}

function scrollToBottom() {
  var elems = document.getElementsByClassName('lv-chat-container')
  if (elems.length) elems[0].scrollTop = elems[0].scrollHeight
}

const onToggleChat = () => {
  $('.lv-chat-toggle').text(IS_CONSOLE_OPEN ? '' : '')
  $('.lv-chat-container').css({
    height: IS_CONSOLE_OPEN ? '180px' : '0',
    padding: IS_CONSOLE_OPEN ? '.25rem .5rem' : '0',
    'border-top': IS_CONSOLE_OPEN ? 'thin solid #414243' : '0',
  })
  $('.lv-chat').css({ opacity: IS_CONSOLE_OPEN ? '1' : '.5' })
}

const setChatState = () => {
  if (INVENTORY) {
    $('.lv-chat-state').text(
      `🪙${INVENTORY.silverCount} 🌹${INVENTORY.roseCount} 🧪${TOTAL_XP_SESSION} 🆙${TOTAL_UP_LEVEL}`
    )
  }
}

const lvChatEl = `
<div class="lv-chat abs">
  <div class="lv-chat-header">
    <div style="display: flex; align-items: center">
      <div class="lv-chat-toggle lv-icon"></div>
      LoupsVille v${VERSION}
    </div>
    <div class="lv-chat-state"></div>
    <div class="lv-chat-settings lv-icon"></div>
  </div>
  <div class="lv-chat-container"></div>
</div>
`

const lvModal = `
<div class="lv-modal-popup-container">
  <div class="lv-modal-veil"></div>
  <div class="lv-modal">
    <div class="lv-modal-header">
      <div style="display: flex; align-items: center;">
        <div class="lv-icon"></div>
        <span class="lv-modal-title">Settings</span>
      </div>
      <div class="lv-icon lv-modal-close"></div>
    </div>
    <div class="lv-modal-container">
      <div class="lv-modal-section">
        <div class="lv-modal-subtitle">General</div>
        <div class="lv-modal-option">
          <div class="lv-modal-checkbox debug lv-icon"></div>
          <span>Debug mode</span>
        </div>
      </div>
      <div class="lv-modal-section">
        <div class="lv-modal-subtitle">In Game</div>
        <div class="lv-modal-option">
          <div class="lv-modal-checkbox show-hidden-lvl lv-icon"></div>
          <span>Show hidden level of other players</span>
        </div>
        <div class="lv-modal-option">
          <div class="lv-modal-checkbox auto-replay lv-icon"></div>
          <span>Auto replay when game is over (your game must be in english)</span>
        </div>
        <div class="lv-modal-option">
          <div class="lv-modal-checkbox auto-play lv-icon"></div>
          <span>Auto play in custom games (couples settings) <strong class="lv-new">NEW 🔥</strong></span></span>
        </div>
        <div class="lv-modal-option disabled">
          <div class="lv-modal-checkbox chat-stats lv-icon"></div>
          <span>Chat stats perk <strong class="lv-coming-soon">COMING SOON</strong></span>
        </div>
      </div>
      <div class="lv-modal-section">
        <div class="lv-modal-subtitle">Commands</div>
        <div class="lv-modal-command">
          <button class="lv-modal-gold-wheel-btn">Spin Gold Wheel</button>
          <span class="lv-modal-gold-wheel-status"></span>
        </div>
        <div class="lv-modal-command">
          <button class="lv-modal-rose-wheel-btn">Spin Rose Wheel</button>
          <span style="font-style: italic;">(cost 30 🌹/spin)</span>
          <span class="lv-modal-rose-wheel-status"></span>
        </div>
        <div class="lv-modal-command">
          <button class="lv-modal-loot-boxes-btn">Open all loot boxes</button>
          <span class="lv-modal-loot-boxes-status" style="font-style: italic;"></span>
        </div>
      </div>
      <div class="lv-modal-footer">
        Made with ❤️ by
        <strong>&nbsp;Master Chief&nbsp;</strong>
        (discord: masterchief_09)
      </div>
    </div>
  </div>
</div>
`

const lvStyles = `
<style>
div {
  user-select: auto !important;
}
.lv-chat {
  width: 100%;
  margin-top: 1rem;
  box-sizing: border-box;
  background-color: #181818;
  border: thin solid #414243;
  border-radius: .5rem;
  font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #fafafa;
}
.lv-chat-header {
  height: 28px;
  background-color: #181818;
  border-radius: .5rem;
  padding: 0 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lv-modal-close,
.lv-chat-toggle,
.lv-chat-settings {
  font-size: 18px;
  cursor: pointer;
  user-select: none !important;
}
.lv-chat-toggle {
  margin-right: 6px;
}
.lv-chat-state {
  font-weight: 500;
  display: flex;
  align-items: center;
}
.lv-chat-container {
  overflow-y: scroll;
  height: 180px;
  transition: height .25s ease-out;
  scrollbar-color: #fafafa rgba(0, 0, 0, 0) !important;
  display: flex;
  flex-direction: column;
}
.lv-chat.abs {
  position: absolute;
  bottom: 4rem;
  left: 1rem;
  z-index: 1041;
  width: 500px !important;
}
.lv-chat.end {
  position: absolute;
  bottom: -216px;
}
.lv-chat-msg {
  display: inline;
  text-align: inherit;
  text-decoration: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.lv-username {
  color: #fafafa;
  font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-weight: 500;
}
.lv-username-box {
  background-color: #181818;
  padding: 2px 8px 4px 8px;
  border-radius: 8px;
}
.lv-modal-popup-container {
  display: none;
}
.lv-modal {
  z-index: 1042;
  position: absolute;
  left: 50%;
  top: 40%;
  width: 500px;
  transform: translate(-50%, -50%);
  background-color: #181818;
  border: thin solid #414243;
  border-radius: .5rem;
  font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #fafafa;
}
.lv-modal-veil {
  position: absolute;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgb(17, 23, 31);
  opacity: 0.7;
  z-index: 1040;
}
.lv-modal-header {
  height: 2rem;
  font-size: 18px;
  gap: 1rem;
  padding: 0.5rem 1rem 0.5rem 1rem;
  border-bottom: thin solid #414243;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lv-modal-title {
  font-weight: bold;
  margin-left: 0.5rem;
}
.lv-modal-container {
  padding: 1rem 1.25rem;
}
.lv-modal-section {
  padding-bottom: .75rem;
  margin-bottom: .75rem;
  border-bottom: thin solid #414243;
}
.lv-modal-subtitle {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: .5rem;
  }
.lv-modal-command {
  margin-bottom: .25rem;
  display: flex;
  align-items: center;
}
.lv-modal-command button {
  font-size: 14px;
  cursor: pointer;
  margin-right: .5rem;
}
.lv-modal-gold-wheel-status {
  font-weight: bold;
}
.lv-modal-option {
  display: flex;
  align-items: center;
  margin-bottom: .25rem;
}
.lv-modal-option .lv-modal-checkbox {
  margin-right: .5rem;
  font-size: 18px;
  cursor: pointer;
}
.lv-modal-option.disabled {
  color: #fafafa75 !important;
}
.lv-modal-option.disabled .lv-coming-soon {
  color: #ffe31f !important;
}
.lv-modal-option .lv-new {
  color:rgb(255, 2, 2) !important;
}
.lv-modal-option.disabled .lv-modal-checkbox {
  cursor: not-allowed !important;
}
.lv-modal-option span {
  font-size: 14px;
}
.lv-modal-footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.lv-icon {
  font-family: FontAwesome6_Pro_Regular;
}
</style>
`

const patchLocalStorage = () => {
  var orignalSetItem = localStorage.setItem
  localStorage.setItem = function (k, v) {
    if (k == 'open-page') {
      localStorage.removeItem(k)
      return
    }
    orignalSetItem.apply(this, arguments)
  }
}

const getHeaders = () => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: `Bearer ${AUTHTOKENS.idToken}`,
  'Cf-JWT': `${AUTHTOKENS['Cf-JWT']}`,
  ids: 1,
})

const getRewardSecret = () => {
  const i = PLAYER.id
  const o = INVENTORY.silverCount
  const n = PLAYER.xpTotal
  const r = INVENTORY.roseCount
  log(i, o, n, r)
  return `${i.charAt(o % 32)}${i.charAt(n % 32)}${new Date().getTime().toString(16)}${i.charAt((o + 1) % 32)}${i.charAt(
    r % 32
  )}`
}

main()

window.addEventListener('load', function () {})