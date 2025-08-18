const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const uri = "mongodb+srv://julioramirezs2008:JDRS2008@cluster0.mvtvanq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const app = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Initialize Socket.IO with CORS configuration
const io = socketIo(server, {
  cors: {
    origin: "https://place-kpx7.onrender.com", // Allow requests from your frontend URL
    methods: ["GET", "POST"], // Allow specified HTTP methods
    credentials: true // Allow cookies to be sent with cross-origin requests
  }
});

// Middleware para el cuerpo de las peticiones JSON
app.use(express.json());

// Conexión a MongoDB
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Conectado a MongoDB Atlas'))
  .catch(err => console.error('Fallo al conectar a MongoDB', err));

// Modelos de Mongoose
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  pixelCredits: { type: Number, default: 100 }, // Cambiado a 100 píxeles iniciales
});

const pixelSchema = new mongoose.Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  color: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const User = mongoose.model('User', userSchema);
const Pixel = mongoose.model('Pixel', pixelSchema);

// Lógica para añadir píxeles a los usuarios conectados
setInterval(async () => {
  // Obtener los IDs de usuario de los sockets conectados que tienen un userId asignado
  const connectedUserIds = Object.values(io.sockets.sockets)
                                .filter(s => s.userId)
                                .map(s => s.userId);

  if (connectedUserIds.length > 0) {
    // Aumentar los créditos de píxeles para todos los usuarios conectados en la base de datos
    await User.updateMany({ _id: { $in: connectedUserIds } }, { $inc: { pixelCredits: 1 } });
    
    // Notificar a cada cliente individualmente sobre sus nuevos créditos
    for (const socketId in io.sockets.sockets) {
      const socket = io.sockets.sockets[socketId];
      if (socket.userId) {
        // Recuperar el usuario actualizado de la base de datos para obtener el valor más reciente
        const user = await User.findById(socket.userId);
        if (user) {
          socket.emit('updatePixelCredits', { pixelCredits: user.pixelCredits });
        }
      }
    }
  }
}, 5000); // Cambiado a 5 segundos (5000 ms) para la acumulación de píxeles

// Manejo de Conexiones Socket.IO
io.on('connection', (socket) => {
  console.log(`Usuario conectado: ${socket.id}`);

  let currentUserId = null; // Para almacenar el ID del usuario logueado en este socket

  // Evento: Registro de nuevo usuario
  socket.on('register', async ({ username, password }) => {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({ username, password: hashedPassword, pixelCredits: 100 }); // Asegura 100 píxeles al registrar
      await newUser.save();
      socket.emit('authSuccess', 'Registro exitoso. ¡Puedes iniciar sesión!');
    } catch (error) {
      console.error('Error durante el registro:', error);
      socket.emit('authError', 'Error al registrar. El nombre de usuario puede ya existir.');
    }
  });

  // Evento: Inicio de sesión de usuario
  socket.on('login', async ({ username, password }) => {
    try {
      const user = await User.findOne({ username });
      if (!user) {
        socket.emit('authError', 'Usuario no encontrado.');
        return;
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        socket.emit('authError', 'Contraseña incorrecta.');
        return;
      }

      // Guardar el ID del usuario en el socket para referencia futura
      socket.userId = user._id;
      currentUserId = user._id;

      // Cargar todos los píxeles del lienzo y enviarlos al cliente
      const allPixels = await Pixel.find({});
      socket.emit('allPixels', allPixels);

      // Notificar al cliente que ha iniciado sesión con sus créditos actuales
      socket.emit('loginSuccess', { username: user.username, pixelCredits: user.pixelCredits });
      console.log(`${user.username} (${socket.id}) ha iniciado sesión.`);

    } catch (error) {
      console.error('Error durante el inicio de sesión:', error);
      socket.emit('authError', 'Error al iniciar sesión.');
    }
  });

  // Evento: Un usuario intenta colocar un píxel
  socket.on('placePixel', async ({ x, y, color }) => {
    if (!currentUserId) {
      socket.emit('pixelError', 'Debes iniciar sesión para colocar píxeles.');
      return;
    }

    try {
      const user = await User.findById(currentUserId);
      // La verificación de créditos para la colocación de píxeles ha sido eliminada.
      // Los créditos ahora solo se acumulan y se muestran.
      if (!user) { // Asegúrate de que el usuario exista
        socket.emit('pixelError', 'Usuario no encontrado.');
        return;
      }

      // Actualizar o crear el píxel en la base de datos
      // findOneAndUpdate con upsert: true es atómico para esta operación
      await Pixel.findOneAndUpdate(
        { x, y },
        { color, userId: currentUserId },
        { new: true, upsert: true } // new: true devuelve el documento modificado; upsert: true crea si no existe
      );

      // Transmitir el píxel colocado a todos los clientes en tiempo real
      io.emit('pixelPlaced', { x, y, color, userId: currentUserId });
      console.log(`Pixel colocado en (${x}, ${y}) por ${user.username}`);

    } catch (error) {
      console.error('Error al colocar el píxel:', error);
      socket.emit('pixelError', 'Error al colocar el píxel.');
    }
  });

  // Evento: Desconexión del cliente
  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
  });
});

// Sirve los archivos estáticos desde la carpeta 'build' del cliente (React app)
app.use(express.static(path.join(__dirname, '../client/build')));

// Para cualquier otra ruta, sirve el archivo index.html de tu aplicación React
app.get(/^(?!.*\.).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

// Iniciar el servidor HTTP
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
