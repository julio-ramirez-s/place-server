const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// Configuración de Socket.io para permitir conexión desde el cliente React
const io = new Server(server, {
  cors: {
    origin: "https://place-kpx7.onrender.com", // Asegúrate de que esto coincida con tu puerto de React
    methods: ["GET", "POST"]
  }
});

// --- ESTADO DEL JUEGO (Memoria del Servidor) ---
// Nota: Si reinicias el servidor, esto se resetea. Para guardar permanente, usa MongoDB aquí.
let gameState = {
  players: {}, // { socketId: { id, name, avatar, room, action, x, y } }
  pet: {
    name: "Mochi",
    type: "cat", // 'cat' o 'dog'
    hunger: 80, // 0 a 100
    happiness: 60, // 0 a 100
  },
  loveMeter: 0, // Medidor de amor acumulado
  weather: 'sunny' 
};

// --- BUCLE DEL JUEGO ---
// Reduce las estadísticas de la mascota cada 10 segundos para simular vida
setInterval(() => {
  let changed = false;
  
  // La mascota tiene hambre poco a poco
  if (gameState.pet.hunger > 0) {
    gameState.pet.hunger -= 2;
    changed = true;
  }
  
  // La mascota se aburre poco a poco
  if (gameState.pet.happiness > 0) {
    gameState.pet.happiness -= 1;
    changed = true;
  }

  // Si hubo cambios, enviamos actualización a todos
  if (changed) {
    io.emit('game_update', gameState);
  }
}, 10000);

// --- GESTIÓN DE SOCKETS ---
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // 1. Unirse a la casa
  socket.on('join_house', ({ name, avatar }) => {
    gameState.players[socket.id] = {
      id: socket.id,
      name,
      avatar,
      room: 'living', // Sala inicial
      action: 'Acaba de llegar',
    };
    
    // Enviar estado actual inmediatamente al que entra
    socket.emit('game_update', gameState);
    // Avisar a los demás
    socket.broadcast.emit('game_update', gameState);
  });

  // 2. Moverse de habitación
  socket.on('move_room', (roomId) => {
    if (!gameState.players[socket.id]) return;

    const roomActions = {
      bedroom: 'Descansando 💤',
      kitchen: 'Comiendo algo 🍪',
      living: 'Viendo TV 📺',
      garden: 'Tomando aire 🌳'
    };

    // Actualizar jugador
    gameState.players[socket.id].room = roomId;
    gameState.players[socket.id].action = roomActions[roomId] || 'Explorando';

    // LÓGICA ROMÁNTICA:
    // Si hay más de un jugador en la misma habitación, sube el "Love Meter"
    const players = Object.values(gameState.players);
    if (players.length > 1) {
      // Filtrar jugadores en la misma sala que no sean yo
      const othersInRoom = players.filter(p => p.id !== socket.id && p.room === roomId);
      
      if (othersInRoom.length > 0) {
        gameState.loveMeter = Math.min(100, gameState.loveMeter + 5);
        io.emit('notification', `¡${gameState.players[socket.id].name} se unió a ${othersInRoom[0].name} en ${roomId}! ❤️`);
      }
    }

    io.emit('game_update', gameState);
  });

  // 3. Cuidar Mascota
  socket.on('interact_pet', (action) => {
    if (action === 'feed') {
      gameState.pet.hunger = Math.min(100, gameState.pet.hunger + 20); // Sube comida
      io.emit('notification', '¡Mascota alimentada! 🍖');
    } else if (action === 'play') {
      gameState.pet.happiness = Math.min(100, gameState.pet.happiness + 20); // Sube felicidad
      io.emit('notification', '¡Jugando con la mascota! 🎾');
    }
    io.emit('game_update', gameState);
  });

  // 4. Enviar Beso
  socket.on('send_kiss', () => {
    const sender = gameState.players[socket.id];
    if (sender) {
      gameState.loveMeter = Math.min(100, gameState.loveMeter + 10);
      io.emit('special_effect', { type: 'kiss', from: sender.name });
      io.emit('game_update', gameState);
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    delete gameState.players[socket.id];
    io.emit('game_update', gameState);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🏠 Servidor del Nido de Amor corriendo en puerto ${PORT}`);
});