const { CronJob } = require('cron')
const request = require('co-request')
const axios = require('axios')
const co = require('co')
const Random = require('random-js')
const config = require('./config')

const ran = new Random(Random.engines.mt19937().autoSeed())
const { headers } = config
let userid = ''
let followsList = []
const groupsId = []
const sofaList = []
const doing = []
doing.sofa = 0
doing.reply = 0
doing.chat = 0
function log(m) {
  console.log(`${(new Date()).toLocaleDateString()} ${(new Date()).toLocaleTimeString()}`, m)
}
function getSig() {
  const ts = Math.floor((new Date()).getTime() / 1000).toString()
  const sig = Buffer.from((new Date()).getTime().toString()).toString('base64')
  return { _st: ts, _sig: sig }
}
function* tuling(msg) {
  const result = (yield request.post('http://www.tuling123.com/openapi/api', { timeout: 3000, json: true, form: { key: config.tuling, info: msg } })).body
  if (result.text.match(/暂时无法回答|不知道答案/)) {
    return `哎呀我忘了要说什么了${config.facetext[ran.integer(0, config.facetext.length - 1)]}`
  }

  return result.text
}
function* qingyunke(msg) {
  const result = (yield request.get('http://api.qingyunke.com/api.php', { timeout: 3000, json: true, qs: { key: 'free', msg: encodeURI(msg) } })).body
  const text = result.content.replace(/{.*}/, '')
  if (!text.match(/.com|.net|.org|.cn|www/)) {
    return text
  }

  return false
}
async function login() {
  const formData = Object.assign(getSig(), config.form, { username: config.username, password: config.password })
  const res = await axios.post('https://frodo.douban.com/service/auth2/token', { ...formData }, { headers })
  return res
}
function* getGroupId() {
  const { groups } = config
  const qs = Object.assign(getSig(), config.form, { count: 30 })
  const result = (yield request.get(`https://frodo.douban.com/api/v2/group/user/${userid}/joined_groups`, { headers, json: true, qs })).body
  result.groups.forEach((e) => {
    if (groups.includes(e.name)) {
      groupsId.push(e.id)
    }
  })
  log(`小组ID：${groupsId}`)
}
function* addComment(topicId, text, commentId) {
  const formData = commentId ? Object.assign(getSig(), config.form, { content: text, comment_id: commentId }) : Object.assign(getSig(), config.form, { content: text })
  const result = (yield request.post(`https://frodo.douban.com/api/v2/group/topic/${topicId}/add_comment`, { headers, json: true, form: formData })).body
  if (result.msg) {
    log(`${text} ${result.msg}`)
  }
}
function* sofa() {
  try {
    const qs = Object.assign(getSig(), config.form)
    for (const groupId of groupsId) {
      const result = (yield request.get(`https://frodo.douban.com/api/v2/group/${groupId}/topics`, { headers: { 'User-Agent': 'api-client/1 com.douban.frodo/4.11.2(90) Android/22 occam LGE Nexus 4  rom:android' }, json: true, qs })).body
      result.topics.forEach((e) => {
        if (e.author.id == userid && !config.replySelf) {
          return
        }
        if (!config.replyAgain && sofaList.includes(e.id)) {
          return
        }
        if (e.type == 'topic' && !e.is_locked && e.comments_count == 0) {
          co(tuling(e.title)).then((val) => {
            if (val) {
              co(addComment(e.id, val)).then(() => {
                if (!config.replyAgain) {
                  sofaList.push(e.id)
                }
                log(`新帖:${e.title} 回复:${val} topicId:${e.id}`)
              })
            } else {
              log('青云客出了问题（广告）')
            }
          }, (err) => { log(err) })
        }
      })
    }
  } catch (ee) {
    log(ee)
  }
  setTimeout(() => {
    co(sofa)
  }, 500)
}
function* reply() {
  const qs = Object.assign(getSig(), config.form, { count: 30 })
  const notifications = (yield request.get('https://frodo.douban.com/api/v2/mine/notifications', { headers, json: true, qs })).body
  notifications.notifications.forEach((e) => {
    if (!e.is_read) {
      let topicId
      try {
        topicId = e.target_uri.match(/topic\/(\d+)\/comments/)[1]
      } catch (err) {
        // log(err)
        log(`${e.text}`)
        return
      }
      co(function* () {
        const topicInfo = (yield request.get(`https://frodo.douban.com/api/v2/group/topic/${topicId}`, { headers, json: true, qs })).body
        return topicInfo.author.id == userid
      }).then((isSelf) => {
        if (isSelf && !config.replySelf) {
          log('自己的贴子有新回复（已禁用回复自己贴子）')
          return
        }
        const pos = e.target_uri.match(/pos=(\d+)/)[1]
        Object.assign(qs, { count: 1, start: pos })
        co(function* () {
          const thisComment = (yield request.get(`https://frodo.douban.com/api/v2/group/topic/${topicId}/comments`, { headers, json: true, qs })).body
          return thisComment.comments[0]
        }).then((val) => {
          co(tuling(val.text)).then((val2) => {
            co(addComment(topicId, val2, val.id)).then(() => {
              log(`回帖:${val.text} 回复:${val2} commentId:${e.id}`)
            })
          })
        })
      })
    }
  })
}
function* replyChat(userId, msg) {
  const formData = Object.assign(getSig(), config.form, { text: msg, nonce: (new Date()).getTime() })
  const result = (yield request.post(`https://frodo.douban.com/api/v2/user/${userId}/chat/create_message`, { headers, json: true, form: formData })).body
  if (result.msg) {
    log(result.msg)
  } else {
    yield request.post(`https://frodo.douban.com/api/v2/user/${userId}/chat/read_message`, { headers, json: true, form: Object.assign(getSig(), config.form, { last_read_id: result.id }) })
  }
}
function* chat() {
  const qs = Object.assign(getSig(), config.form, { count: 30 })
  const chatList = (yield request.get('https://frodo.douban.com/api/v2/chat_list', { headers, json: true, qs })).body
  chatList.results.forEach((e) => {
    if (e.unread_count && e.type == 'chat') {
      let sieve
      if (followsList.includes(e.target_user.id)) {
        sieve = 1
      } else {
        sieve = ran.integer(0, 1)
      }
      if (sieve) {
        if (e.last_message.type == 0) {
          co(tuling(e.last_message.text)).then((val) => {
            co(replyChat(e.target_user.id, val)).then(() => {
              log(`回聊天:${e.last_message.text} 回复:${val} userId:${e.target_user.id}`)
            })
          })
        } else if (e.last_message.type == 3) {
          co(replyChat(e.target_user.id, '正在收集表情包！')).then(() => {
            log(`回聊天:(图片) 回复:正在收集表情包！ userId:${e.target_user.id}`)
          })
        }
      } else {
        co(replyChat(e.target_user.id, `你好像还没关注我呢${config.facetext[ran.integer(0, config.facetext.length - 1)]}`)).then(() => {
          log(`回聊天:${e.last_message.text}(未关) 回复:你好像还没关注我呢 userId:${e.target_user.id}`)
        })
      }
    }
  })
}
function* follows() {
  try {
    const tempList = []
    const qs = Object.assign(getSig(), config.form, { start: 0, count: 50 })
    const result = (yield request.get(`https://frodo.douban.com/api/v2/user/${userid}/followers`, { headers, json: true, qs })).body
    let totel = result.total
    result.users.forEach((fols) => {
      tempList.push(fols.id)
    })
    const i = 1
    while (totel > 50) {
      qs.start = 50 * i
      const result = (yield request.get(`https://frodo.douban.com/api/v2/user/${userid}/followers`, { headers, json: true, qs })).body
      result.users.forEach((fols) => {
        tempList.push(fols.id)
      })
      totel -= 50
    }
    if (followsList.length != tempList.length) {
      log(`关注增量:${tempList.length - followsList.length}`)
    }
    followsList = tempList
  } catch (ee) {
    log(ee)
  }
  setTimeout(() => { co(follows) }, 10000)
}

function start() {
  // let sofaRobot = new CronJob('*/8 * * * * *',function(){co(sofa)}, null, true, 'Asia/Shanghai');
  co(sofa)
  const replyRobot = new CronJob('*/45 * * * * *', (() => { co(reply) }), null, true, 'Asia/Shanghai')
  const chatRobot = new CronJob('*/10 * * * * *', (() => { co(chat) }), null, true, 'Asia/Shanghai')
  co(follows)
  // co(sofa)
  // co(reply)
  // co(chat)
}
async function main() {
  const res = await login()
  console.log('res.body', res)
  if (res.msg) {
    log(`登陆出错 ${res.msg}`)
  } else {
    log(`已登陆 ID:${res.douban_user_id} 用户:${res.douban_user_name} Token:${res.access_token}`)
    headers.Authorization = `Bearer ${res.access_token}`
    userid = res.douban_user_id
    co(getGroupId).then(() => {
      start()
    })
  }
}
main()
