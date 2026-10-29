// Render будет показывать полную ошибку в логах, а не просто завершать процесс.
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT ERROR:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});


const { WebSocketServer } = require('ws');
const sqlite3 = require('sqlite3');
const host = '0.0.0.0';
const port = process.env.PORT || 3000;

const db = new sqlite3.Database('appDatabase.db', (err) => {
  if (err) {
    console.error('Ошибка подключения DB:', err.message);
    return;
  }
  console.log('База данных подключена');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      friend_name TEXT NOT NULL
     ); 
    `)
  db.run(`
    CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    receiver TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
    );
  `)
  
});

const wss = new WebSocketServer({ host, port });
const clients = new Set();
const clientsId = new Map(); 

wss.on('listening', () => {
  console.log(`WebSocket создан: ws://${host}:${port}`);
});

wss.on('connection', (ws, req) => {
  clients.add(ws);

  const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
  console.log(`Клиент подключился: ${clientIp}`);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if(data.type === 'friend_message_history'){
        const sender = String(data.sender || '').trim();
        const receiver = String(data.receiver || '').trim();

        db.all(`SELECT sender, receiver, text, created_at FROM private_messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY created_at ASC`, [sender, receiver, receiver, sender], (err, rows) => {
          if(err) return;
          ws.send(JSON.stringify({
            type: 'friend_message_history',
            messages: rows
          }));
        });
      }

      if (data.type === 'friend_message') {
        const sender = String(data.sender || '').trim();
        const receiver = String(data.receiver || '').trim();
        const text = String(data.text || '').trim();

        if (!sender || !text) return;

        const createdAt = new Date().toISOString();

        db.run(`INSERT INTO private_messages (sender, receiver, text, created_at) VALUES (?, ?, ?, ?)`, [sender, receiver, text, createdAt], (err) => {
          if (err) {
            console.error(err);
          }
          const message = {
            type: 'friend_message',
            sender,
            text,
            receiver,
            created_at: createdAt
          }
        
        db.get(`SELECT id FROM registration WHERE name = ?`, [receiver], (err, row) => {
              if (err) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Ошибка БД'
              }));
              return;
              }
              if (!row) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Пользователь не найден'
                }));
                return;
              }
              const friendSocket = clientsId.get(row.id);
              if(friendSocket){
              friendSocket.send(JSON.stringify(message));
              }
              ws.send(JSON.stringify(message));
            });
          });
      }
///////////// получение данных логина
      if(data.type === 'login'){
        const name = String(data.name || '').trim();
        const password = String(data.password || '').trim();

        if(!name || !password) return;
       
        db.get(`SELECT id, name, password FROM registration WHERE name = ?`, [name], (err, row) => {

          if (err) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Ошибка базы данных'
            }));
            return;
          }

          if (row && row.password === password) {
            ws.send(JSON.stringify({
              type: 'login_result',
              success: true,
              message: 'Вход выполнен успешно',
              user: {
                id: row.id,
                name: row.name
              }
            }));
            clientsId.set(row.id, ws);
            ws.userId = row.id;
          } else {
              ws.send(JSON.stringify({
              type: 'login_result',
              success: false,
              message: 'Неверный логин или пароль'
              }));
            }
        });
      }
///////////// получение данных регистрации
      if(data.type === 'registration'){
        const nameregistr = String(data.nameregistr || '').trim();
        const passwordregistr = String(data.passwordregistr || '').trim();

        if(!nameregistr || !passwordregistr) return;
        
        db.get(`SELECT id FROM registration WHERE name = ?`, [nameregistr], (err, existing) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка БД' }));
            return;
          }
          if (existing) {
            ws.send(JSON.stringify({
              type: 'register_result',
              success: false,
              message: 'Пользователь с таким именем уже существует'
            }));
            return;
          }
          db.run(`INSERT INTO registration (name, password) VALUES (?, ?)`, [nameregistr, passwordregistr], function (err) {
            if (err) {
              ws.send(JSON.stringify({
                type: 'register_result',
                success: false,
                message: 'Ошибка записи в БД'
              }));
              return;
            }
            clientsId.set(this.lastID, ws);
            ws.userId = this.lastID;
            ws.send(JSON.stringify({
              type: 'register_result',
              success: true,
              message: 'Регистрация прошла успешно'
            }));
          });
        });
      }
      //////////// добавление в друзья
      if(data.type === 'name_friend'){
        const nameAdd = String(data.nameAdd || '').trim();
        let send_invite_name = data.send_invite_name;
        if(!nameAdd) return;
        
        db.get(`SELECT id, name FROM registration WHERE name = ?`, [nameAdd], (err, row) => {
          if (err) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Ошибка БД'
            }));
            return;
          }
          if (!row) {
            ws.send(JSON.stringify({
              type: 'name_friend_result',
              success: false,
              message: `Пользователь ${nameAdd} не найден`
            }));
            return;
          }
          if (row.name === send_invite_name) {
            ws.send(JSON.stringify({
              type: 'name_friend_result',
              success: false,
              message: 'Нельзя добавить в друзья самого себя'
            }));
            return;
          }
          const friendSocket = clientsId.get(row.id);
          if(!friendSocket || friendSocket.readyState !== 1){
            ws.send(JSON.stringify({
              type: 'name_friend_result',
              success: false,
              message: 'Пользователь сейчас не в сети'
            }));
            return;
          }
          ws.send(JSON.stringify({
            type: 'name_friend_result',
            success: true,
            message: `Запрос в друзья пользователю ${nameAdd} отправлен`
          }));
          friendSocket.send(JSON.stringify({
            type: 'friend_request',
            message: `Запрос в друзья от ${send_invite_name}`,
            send_invite_name,
            sender: send_invite_name
          }));
        });
      }
///////////// получение имени для добавления в друзья
      if(data.type === 'friend_accept'){
        const sender = String(data.sender || '').trim();
        const receiver = String(data.currentUserName || '').trim();
        if (!sender || !receiver || sender === receiver) return;

        const sendFriendList = (name, socket) => {
          if (!socket || socket.readyState !== 1) return;
          db.all(`SELECT friend_name FROM friends WHERE name = ?`, [name], (err, rows) => {
            if (err) {
              socket.send(JSON.stringify({ type: 'error', message: 'Ошибка БД' }));
              return;
            }
            socket.send(JSON.stringify({ type: 'friend_list', friends: rows }));
          });
        };

        db.get(`SELECT id FROM friends WHERE name = ? AND friend_name = ?`, [receiver, sender], (err, existing) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка БД' }));
            return;
          }
          db.serialize(() => {
            if (!existing) {
              db.run(`INSERT INTO friends (name, friend_name) VALUES (?, ?)`, [sender, receiver]);
              db.run(`INSERT INTO friends (name, friend_name) VALUES (?, ?)`, [receiver, sender]);
            }
            db.get(`SELECT id FROM registration WHERE name = ?`, [sender], (err, row) => {
              sendFriendList(receiver, ws);
              if (!err && row) sendFriendList(sender, clientsId.get(row.id));
            });
          });
        });
      }

      if (data.type === 'friends') {
        const name = String(data.name || '').trim();

        db.all(`SELECT friend_name FROM friends WHERE name = ?`, [name], (err, rows) => {
          if (err) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Ошибка БД'
            }));
            return;
          }

          ws.send(JSON.stringify({
            type: 'friend_list',
            friends: rows
          }));
        });
      }
      
    } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Некорректный JSON'
        }));
      }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws.userId && clientsId.get(ws.userId) === ws) {
      clientsId.delete(ws.userId);
    }
    console.log('Пользователь отключился');
  });

  ws.on('error', (err) => {
    clients.delete(ws);
    console.error('Ошибка клиента:', err.message);
  });
});
