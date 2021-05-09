var express = require('express');

// 文件系统
var fs = require('fs');
var fsp = require('fs').promises;
var path = require('path');

var moment = require('moment');

// 邮箱-密码找回
const nodemailer = require('nodemailer');

var multer = require('multer');
// 附件上传
const upload = multer({dest:'uploads/'});

// 验证码
var svgCaptcha = require('svg-captcha');

var cookieParser = require('cookie-parser');

var cors = require('cors');

const WebSocket = require('ws');
const http = require('http');

const _ = require('lodash');

const DBUtil = require('./DBUtil');
// console.log("当前DBUtil的值为：",DBUtil);

var app = express();
var port = 8081;

const server = http.createServer(app); // express返回的server就是用来传给createServer的
// const wss = new WebSocket.Server({server});
const io  = require("socket.io").listen(server);

// 数据库
const mysql = require('mysql');
let connection = mysql.createConnection({
    host:'localhost', // 这里在上线后修改成服务器的数据
    // ssl 证书
    // ssl:{
    //     ca:fs.readFileSync(__dirname+'/mysql-ca.crt');
    // },
    user:'root',
    password:'admin',
    database:'joblog'
});
connection.connect(err=>{
    if(err){
        console.error('error connecting： '+err.stack);
        return;
    }
    console.log('数据库连接成功！连接线程id为：'+connection.threadId);
})

// 打印访问日志
app.use((req,res,next)=>{
    console.log(req.method,req.url);
    next();
})


// 跨域
app.use(cors({
    maxAge:86400,
    origin:'*',
    credentials:true
}))

app.use(express.static(__dirname+'/build'))
app.use(express.static(__dirname+'/static'))
//存放头像的文件夹
app.use('/uploads',express.static(__dirname+'/uploads'))


// 不能解析multipart/form-data编码格式的表单
app.use(express.json()); // application/x-json
app.use(express.urlencoded({extended:true})); // application/x-www-urlencoded

// 这样设置之后会把这个字符串进行发签名
app.use(cookieParser('username'))

// 做验证码需要先写session，服务器对浏览器的标识 sessionId
var sessionStore = Object.create(null);
app.use(function sessionMW(req,res,next){
    if(req.cookies.sessionId){
        req.session = sessionStore[req.cookies.sessionId]
        // 这个判断什么情况会出现？
        if(!req.session){
            req.session = sessionStore[req.cookies.sessionId] = {}
        }
    }else{
        let id = Math.random().toString(16).slice(2);
        req.session = sessionStore[id] = {};
        res.cookie('sessionId',id,{
            maxAge:8640000
        })
    }
    next();
})


// 设置cookie
app.use(async (req,res,next)=>{
    // console.log('有没有进入这个方法',req.signedCookies.username);
    // 从签名cookie中找出该用户的信息并挂在到req对象上以供后序续的中间件访问
    if(req.signedCookies.username){
        // console.log("req.signedCookies.username为：",req.signedCookies.username);
        // await connection.query('select * from users where username = ? ',req.signedCookies.username,(err,resSQL)=>{
        //     if(err) throw err;
        //     console.log("cookie处req.user的值为：",resSQL);
        //     req.user = resSQL[0];
        // });
        let strSQL = `select * from users where username = ?`;
        await DBUtil.executeSql(connection,strSQL,req.signedCookies.username).then(val=>{
            console.log("cookie处req.user的值为：",val);
            req.user = val[0];
        }).catch(err=>{ 
            console.log(err);
        })
    }
    next();
})

// index页点击，查询所有数据
app.post("/logs",async (req,resApp)=>{
    // mysql 在查询数据的时候是不能结束连接的
    await connection.query('select * from `logs`',(err,resSQL,fields)=>{
        if(err) throw err;
        // console.log("/logs接口拿到的值为：",resSQL);
        resApp.json(resSQL);
    });
})

// 分页查询：查询不同种类的数据，每次只返回5条数据
app.post("/logsMore/:categoryName/:count",async (req,resApp,next)=>{
    let categoryName = req.params.categoryName;
    let count = req.params.count;
    await connection.query(`select * from logs where categoryName = ? limit ${count*5},5`,[categoryName,count],(err,resSQL,fields)=>{
        if(err) throw err;
        console.log('分页查询拿到的值为：',resSQL);    
        resApp.json(resSQL);
    });
})

// 添加留言接口
app.post("/addLogs",(req,resApp,next)=>{
    let logsArr = req.body.logs;
    let strSql = `insert into logs(id,content,addTime,addUserId,categoryId,categoryName,flag) values ?`;
    // 注册时间
    let addTime = moment().format('YYYY-MM-DD hh:mm:ss');
    let userId = req.user.id;
    let newLogsArr = logsArr.map(log=>[,log.content,addTime,userId,,log.categoryName,'false'])
    connection.query(strSql,[newLogsArr],(err,resSQL)=>{
        if(err) throw err;
        if(resSQL.affectedRows>=1){
            console.log('插入成功');
            resApp.json({
                res:'添加成功',
                code:200
            })
        }
    })
})

// 查询所有的分类
app.post("/categorys",async (req,resApp,next)=>{
    await connection.query(`select * from categorys`,(err,resSQL,fields)=>{
        if(err) throw err;
        console.log('分类查询拿到的值为：',resSQL);    
        resApp.json(resSQL);
    });
})

// 查询分类的id
app.post("/getCategoryId",async (req,resApp,next)=>{
    let categoryName = req.body.categoryName;
    console.log("/getCategoryId接口拿到的值为：",categoryName);
    await connection.query(`select id from categorys where categoryName = ?`,categoryName,(err,resSQL)=>{
        if(err) throw err;
        resApp.json(resSQL);        
    })
})


// 留言板添加留言
app.post("/addMsg",async (req,resApp,next)=>{
    let msgs = req.body;
    // 注册时间 
    let addTime = moment().format('YYYY-MM-DD hh:mm:ss');
    let userId;
    if(req.user){
        userId = req.user.id;
    }else{
        userId=null;
    }
    try{
        let insertSql = 'insert into msgs set ?';
        let insertVal = {
            id:null,
            msgName:msgs.msgName,
            msgContent:msgs.msgContent,
            msgDate:addTime,
            addMsgUserId:userId,
        }
        connection.query(insertSql,insertVal,async (err,res)=>{
            if(err) throw err;
            if(res.affectedRows>=1){
                console.log('插入成功');
                await connection.query(`select * from msgs`,(err,resSQL)=>{
                    if(err) throw err;
                    resApp.json({
                        res:'添加成功',
                        code:200,
                        msgs:resSQL
                    });
                })
            }else{
                console.log('插入失败');
            }
        })
    }catch(err){
        resApp.json({
            res:'添加失败'+err.toString(),
            code:500
        })
    }
})

// 留言板获得留言接口
app.post("/getMsgs",async (req,resApp,next)=>{
    await connection.query(`select * from msgs`,(err,resSQL)=>{
        if(err) throw err;
        resApp.json(resSQL);
    })
})


// 登录接口
app.post("/login",async (req,resApp,next)=>{
    let loginUser = req.body;
    await connection.query(`select * from users where email = ?`,loginUser.email,(err,resSQL)=>{
        if(err) throw err;
        if(resSQL[0].password == loginUser.password){
            resApp.cookie('username',resSQL[0].username,{
                maxAge:8640000,
                signed:true
            });
            resApp.cookie('user',resSQL[0].username,{
                maxAge:8640000,
                // signed:true
            });
            resApp.json(resSQL[0])
        }else{
            resApp.status(401).json({
                res:'登录失败',
                code:-1
            })
        }
    });
})

// 用户详情接口
app.get('/userinfo',async (req,res,next)=>{
    // console.log("/userinfo接口中req.user的值为：",req.user);
    if(req.user){
        res.json(req.user)
    }else{
        res.status(404).json({
            msg:'用户未登录',   
            code:-1
        })
    }
})

// 注册接口
app.route("/register")
    .post(upload.single('avatar'),async (req,resApp,next)=>{
        console.log("进入注册接口");
        // 图片上传后 通过multer 解析之后 在 req对象的file字段中
        let file = req.file;
        console.log("当前的file值为：",file);
        let userInfo = req.body;
        console.log("当前useR的值为：",userInfo);
        let avatarOnlineUrl;
        if(file){
            let targetPath = file.path+'-'+file.originalname;
            await fsp.rename(file.path,targetPath);
            avatarOnlineUrl = '/uploads/'+path.basename(targetPath);
        }else{
            avatarOnlineUrl = '/uploads/avatar.jpg';
        }
        // 注册时间
        let regTime = moment().format('YYYY-MM-DD hh:mm:ss');
        try{
            let insertSql = 'insert into users set ?';
            let insertVal = {
                id:null,
                username:userInfo.username,
                password:userInfo.password,
                avatar:avatarOnlineUrl,
                email:userInfo.email,
                registerTime:regTime
            }
            connection.query(insertSql,insertVal,(err,res)=>{
                if(err) throw err;
                if(res.affectedRows>=1){
                    console.log('插入成功');
                    resApp.json({
                        res:'注册成功',
                        code:200
                    });
                }else{
                    console.log('插入失败');
                }
            })
        }catch(err){
            resApp.json({
                res:'注册失败'+err.toString(),
                code:500
            })
        }
    })

// 验证邮箱是否重复
app.post("/isConflicted/:emailVal",async (req,resApp,next)=>{
    let emailVal = req.params.emailVal;
    await connection.query(`select * from users where email = ?`,emailVal,(err,resSQL,fields)=>{
        if(err) throw err;
        console.log('拿到的值为：',resSQL);        
        resApp.json(resSQL);
    })
});

// 退出登录接口
app.post("/logout",(req,res,next)=>{
    console.log("这里是/logout接口");
    res.clearCookie('username');
    res.clearCookie('user');
    res.clearCookie('sessionId');  // 这个没起到作用
    res.end();
})


app.get("/",(req,res)=>{
    res.json("欢迎来到joblog的世界！");
})


// io socket 聊天室 模块
// 在线用户
let onlineUsers = {};
// 在线用户人数
let onlineCount = 0;
io.on('connection',function(socket){

    // 聊天室连接
    socket.on('login',function(obj){
        console.log('someone coming here!');
        // 用户id设置为socketId
        socket.id=obj.uid;
        // 如果没有这个用户，那么在线人数+1，将其添加进在线用户
        if(!onlineUsers[obj.uid]){
            onlineUsers[obj.uid] = obj.username;
            onlineCount++;
        }
        // 向客户端发送登录事件，同时发送在线用户、在线人数以及登录用户
        io.emit('login',{onlineUsers:onlineUsers,onlineCount:onlineCount,user:obj})

    })    

    // 监听客户端的断开连接
    socket.on('disconnect', function() {
        // 如果有这个用户
        if (onlineUsers[socket.id]) {
            var obj = { uid: socket.id, username: onlineUsers[socket.id] };

            // 删掉这个用户，在线人数-1
            delete onlineUsers[socket.id];
            onlineCount--;

            // 向客户端发送登出事件，同时发送在线用户、在线人数以及登出用户
            io.emit('logout', { onlineUsers: onlineUsers, onlineCount: onlineCount, user: obj });
            console.log(obj.username + '退出了群聊');
        }
    });

     // 监听客户端发送的信息
    socket.on('message', function(obj) {
        io.emit('message', obj);
        console.log(obj.username + '说:' + obj.message);
    });
    
});


io.close();


// https://juejin.im/entry/6844903463659241480
// https://www.jianshu.com/p/70114c9a27e8
// https://www.google.com/search?q=node+socket.io%E5%AE%9E%E7%8E%B0%E5%85%AC%E5%85%B1%E8%81%8A%E5%A4%A9%E5%AE%A4&oq=node+socket.io%E5%AE%9E%E7%8E%B0%E5%85%AC%E5%85%B1%E8%81%8A%E5%A4%A9%E5%AE%A4&aqs=chrome..69i57.12980j0j7&sourceid=chrome&ie=UTF-8
// https://www.bilibili.com/video/BV1yi4y1t7yD?p=9
// https://www.jianshu.com/p/f2acd207c232
// https://blog.csdn.net/BigChicken3/article/details/90452800
// https://socket.io/docs/client-installation/

server.listen(port,'127.0.0.1',()=>{
    console.log(`app listening on ${port}`);
    console.log('__dirname为：',__dirname);  // F:\大喵前端\miao-node-t-2020-8-3\t-2020-8-14-engineer-express-pug-bbs
})