"use strict"
let cronJob = require('cron').CronJob
let request = require('co-request')
let co = require('co')
let config = require('./config')
var random = require('random-js')
var ran = new random(random.engines.mt19937().autoSeed())
const log = function(m) {
	console.log(`${(new Date()).toLocaleDateString()} ${(new Date()).toLocaleTimeString()}`,m)
}

let headers = config.headers
let userid = ""
let groupsId = []
let sofaList = []
let getSig = function(){
	let ts = Math.floor((new Date()).getTime()/1000).toString()
	let sig = new Buffer((new Date()).getTime().toString()).toString("base64")
	return {"_st":ts,"_sig":sig}
}
let tuling = function*(msg){
	let result = (yield request.post("http://www.tuling123.com/openapi/api",{timeout:3000,json:true,form:{key: config.tuling, info: msg}})).body
	if(result.text.match(/暂时无法回答|不知道答案/))
	{
		return `哎呀我忘了要说什么了${config.facetext[ran.integer(0,config.facetext.length-1)]}`
	}
	else{
		return result.text
	}
}
let qingyunke = function*(msg){
	let result = (yield request.get("http://api.qingyunke.com/api.php",{timeout:3000,json:true,qs:{key: "free", msg: encodeURI(msg)}})).body
	var text = result.content.replace(/{.*}/, "")
	if(!text.match(/.com|.net|.org|.cn|www/)){
		return text
	}
	else{
		return false
	}
}
let login = function*(){
	let formData = Object.assign(getSig(),config.form,{"username":config.username,"password":config.password})
	let result = (yield request.post("https://frodo.douban.com/service/auth2/token",{headers:headers,json:true,form:formData})).body
	return result
}
let getGroupId = function*(){
	let groups = config.groups
	let qs = Object.assign(getSig(),config.form,{"count":30})
	let result = (yield request.get(`https://frodo.douban.com/api/v2/group/user/${userid}/joined_groups`,{headers:headers,json:true,qs:qs})).body
	result.groups.forEach(function(e){
		if(groups.includes(e.name)){
			groupsId.push(e.id)
		}
	})
	log(`小组ID：${groupsId}`)
}
let addComment = function*(topicId,text,commentId){
	let formData = commentId?Object.assign(getSig(),config.form,{content:text,comment_id:commentId}):Object.assign(getSig(),config.form,{content:text})
	let result = (yield request.post(`https://frodo.douban.com/api/v2/group/topic/${topicId}/add_comment`,{headers:headers,json:true,form:formData})).body
	if(result.msg){
		log(`${text} ${result.msg}`)
	}
}
let sofa = function*(){
	try{
		let qs = Object.assign(getSig(),config.form)
		for(let groupId of groupsId){
			let result = (yield request.get(`https://frodo.douban.com/api/v2/group/${groupId}/topics`,{headers:{"User-Agent":"api-client/1 com.douban.frodo/4.11.2(90) Android/22 occam LGE Nexus 4  rom:android"},json:true,qs:qs})).body
			result.topics.forEach(function(e){
				if(e.author.id==userid&&!config.replySelf){
					return
				}
				if(!config.replyAgain&&sofaList.includes(e.id)){
					return
				}
				if(e.type=="topic"&&!e.is_locked&&e.comments_count==0){
					co(tuling(e.title)).then(function(val){
						if(val){
							co(addComment(e.id,val)).then(function(){
								if(!config.replyAgain){
									sofaList.push(e.id)
								}
								log(`新帖:${e.title} 回复:${val} topicId:${e.id}`)
							})
						}
						else{
							log(`青云客出了问题（广告）`)
						}
					},function(err){log(err)})
				}
			})
		}
	}
	catch(ee){
		log(ee)
	}
	setTimeout(function(){
		co(sofa)
	},500)
}
let reply = function*(){
	let qs = Object.assign(getSig(),config.form,{"count":30})
	let notifications = (yield request.get(`https://frodo.douban.com/api/v2/mine/notifications`,{headers:headers,json:true,qs:qs})).body
	notifications.notifications.forEach(function(e){
		if(!e.is_read){
			let topicId
			try{
				topicId = e.target_uri.match(/topic\/(\d+)\/comments/)[1]
			}
			catch(err){
				//log(err)
				log(`${e.text}`)
				return
			}
			co(function*(){
				let topicInfo = (yield request.get(`https://frodo.douban.com/api/v2/group/topic/${topicId}`,{headers:headers,json:true,qs:qs})).body
				return topicInfo.author.id==userid
			}).then(function(isSelf){
				if(isSelf&&!config.replySelf){
					log(`自己的贴子有新回复（已禁用回复自己贴子）`)
					return
				}
				let pos = e.target_uri.match(/pos=(\d+)/)[1]
				Object.assign(qs,{"count":1,"start":pos})
				co(function*(){
					let thisComment = (yield request.get(`https://frodo.douban.com/api/v2/group/topic/${topicId}/comments`,{headers:headers,json:true,qs:qs})).body
					return thisComment.comments[0]
				}).then(function(val){
					co(tuling(val.text)).then(function(val2){
						co(addComment(topicId,val2,val.id)).then(function(){
							log(`回帖:${val.text} 回复:${val2} commentId:${e.id}`)
						})
					})
				})
			})
		}
	})
}
let replyChat = function*(userId,msg){
	let formData = Object.assign(getSig(),config.form,{text:msg,nonce:(new Date()).getTime()})
	let result = (yield request.post(`https://frodo.douban.com/api/v2/user/${userId}/chat/create_message`,{headers:headers,json:true,form:formData})).body
	if(result.msg){
		log(result.msg)
	}
	else{
		yield request.post(`https://frodo.douban.com/api/v2/user/${userId}/chat/read_message`,{headers:headers,json:true,form:Object.assign(getSig(),config.form,{last_read_id:result.id})})
	}
}
let chat = function*(){
	let qs = Object.assign(getSig(),config.form,{"count":30})
	let chatList = (yield request.get(`https://frodo.douban.com/api/v2/chat_list`,{headers:headers,json:true,qs:qs})).body
	chatList.results.forEach(function(e){
		if(e.unread_count&&e.type=="chat"){
			let sieve
			if(followsList.includes(e.target_user.id)){
				sieve = 1
			}
			else{
				sieve = ran.integer(0,1)
			}
			if(sieve){
				if(e.last_message.type==0){
					co(tuling(e.last_message.text)).then(function(val){
						co(replyChat(e.target_user.id,val)).then(function(){
							log(`回聊天:${e.last_message.text} 回复:${val} userId:${e.target_user.id}`)
						})
					})
				}
				else if(e.last_message.type==3){
					co(replyChat(e.target_user.id,"正在收集表情包！")).then(function(){
						log(`回聊天:(图片) 回复:正在收集表情包！ userId:${e.target_user.id}`)
					})
				}
			}
			else{
				co(replyChat(e.target_user.id,`你好像还没关注我呢${config.facetext[ran.integer(0,config.facetext.length-1)]}`)).then(function(){
					log(`回聊天:${e.last_message.text}(未关) 回复:你好像还没关注我呢 userId:${e.target_user.id}`)
				})
			}
			
		}
	})
}
let followsList = []
let follows = function*(){
	try{
		let tempList = []
		let qs = Object.assign(getSig(),config.form,{"start":0,"count":50}) 
		let result = (yield request.get(`https://frodo.douban.com/api/v2/user/${userid}/followers`,{headers:headers,json:true,qs:qs})).body
		let totel = result.total
		result.users.forEach(function(fols){
			tempList.push(fols.id)
		})
		let i = 1
		while(totel>50){
			qs.start = 50*i
			let result = (yield request.get(`https://frodo.douban.com/api/v2/user/${userid}/followers`,{headers:headers,json:true,qs:qs})).body
			result.users.forEach(function(fols){
				tempList.push(fols.id)
			})
			totel = totel-50
		}
		if(followsList.length!=tempList.length){
			log(`关注增量:${tempList.length-followsList.length}`)
		}
		followsList = tempList
	}
	catch(ee){
		log(ee)
	}
	setTimeout(function(){co(follows)},10000)
}
let doing = []
doing["sofa"] = 0
doing["reply"] = 0
doing["chat"] = 0
let start = function(){
	//let sofaRobot = new cronJob('*/8 * * * * *',function(){co(sofa)}, null, true, 'Asia/Shanghai');
	co(sofa)
	let replyRobot = new cronJob('*/45 * * * * *',function(){co(reply)}, null, true, 'Asia/Shanghai');
	let chatRobot = new cronJob('*/10 * * * * *',function(){co(chat)}, null, true, 'Asia/Shanghai');
	co(follows)
	// co(sofa)
	// co(reply)
	// co(chat)
}
let main = function(){
	co(login).then(function(val){
		if(val.msg){
			log(`登陆出错 ${val.msg}`)
		}
		else{
			log(`已登陆 ID:${val.douban_user_id} 用户:${val.douban_user_name} Token:${val.access_token}`)
			headers.Authorization = `Bearer ${val.access_token}`
			userid = val.douban_user_id
			co(getGroupId).then(function(){
				start()
			})
		}
	})
}
main()