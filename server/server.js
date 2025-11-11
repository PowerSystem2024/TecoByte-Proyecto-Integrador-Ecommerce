// Importación de módulos
const express = require("express");
const cors = require("cors");
const path = require("path"); // Asegúrate de que path esté importado
const { MercadoPagoConfig, Preference } = require("mercadopago");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

// Conexión a MongoDB
mongoose.connect("mongodb://localhost:27017/tuEcommerceDB")
  .then(() => console.log("Conectado a MongoDB ✅"))
  .catch(err => console.error("Error al conectar a MongoDB ❌", err));

const app = express();

// Configuración del cliente de MercadoPago
const client = new MercadoPagoConfig({
  accessToken:
    "APP_USR-8138947811183604-090515-899a7a5086da64a9e4888eca5e229625-2665253413",
});

// Middlewares
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- ¡¡LÍNEA CRÍTICA MODIFICADA PARA VERCEL!! ---
// En lugar de __dirname, usamos process.cwd() (el directorio raíz del proyecto)
app.use(express.static(path.resolve(process.cwd(), "client")));
// ------------------------------------------------

app.use(cors());

// Configuración de Express Session
app.use(session({
  secret: "tu_secreto_aqui_super_seguro", // ¡Cambia esto!
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Poner en true si usas HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 1 día
  }
}));

// Middleware de Autenticación
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.status(401).json({ error: "No autorizado. Debes iniciar sesión." });
};

// --- RUTAS PÚBLICAS ---
// Nota: Ahora que express.static funciona, estas rutas 
// podrían no ser necesarias si el 'index.html' está en la raíz de 'client'
// Pero las dejamos por si acaso y para las rutas de /feedback
app.get("/", (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "client", "media", "index.html"));
});

app.get("/feedback", (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "client", "media", "feedback.html"));
});

// --- RUTAS DE API DE AUTENTICACIÓN ---

// RUTA DE REGISTRO
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ message: "Email y contraseña son requeridos." });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres." });
    }
    if (password.length > 32) {
        return res.status(400).json({ message: "La contraseña no debe exceder los 32 caracteres." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "El email ya está en uso." });
    }
    
    const newUser = new User({ email, password }); 
    await newUser.save(); 
    
    res.status(201).json({ message: "Usuario registrado con éxito. Ahora puedes iniciar sesión." });
  
  } catch (error) {
    if (error.name === 'ValidationError') {
      const message = Object.values(error.errors).map(val => val.message)[0];
      return res.status(400).json({ message: message });
    }
    console.error("Error en /api/register:", error);
    res.status(500).json({ error: "Error interno en el registro." });
  }
});


app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email y contraseña son requeridos." });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Email o contraseña incorrectos." });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Email o contraseña incorrectos." });
    
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    res.status(200).json({ message: "Login exitoso.", email: user.email });
  } catch (error) {
    console.error("Error en /api/login:", error);
    res.status(500).json({ error: "Error en el login." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Error al cerrar sesión." });
    res.clearCookie('connect.sid'); 
    res.status(200).json({ message: "Sesión cerrada exitosamente." });
  });
});

app.get("/api/session-status", (req, res) => {
  if (req.session.userId) {
    res.status(200).json({ isLoggedIn: true, email: req.session.userEmail });
  } else {
    res.status(200).json({ isLoggedIn: false });
  }
});

// --- RUTAS DE API PARA EL CARRITO (Protegidas) ---

app.get("/api/cart", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user.cart) {
        user.cart = [];
    }
    res.status(200).json(user.cart);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el carrito." });
  }
});

app.post("/api/cart/add", isAuthenticated, async (req, res) => {
  const productToAdd = req.body; 
  try {
    const user = await User.findById(req.session.userId);

    if (!user.cart) {
        user.cart = [];
    }

    const productIndex = user.cart.findIndex(item => item.id === productToAdd.id);
    
    if (productIndex > -1) {
      user.cart[productIndex].quanty++;
    } else {
      user.cart.push({ ...productToAdd, quanty: 1 });
    }
    
    await user.save(); 
    res.status(200).json(user.cart); 
  } catch (error) {
    console.error("Error en /api/cart/add:", error);
    res.status(500).json({ error: "Error al añadir producto." });
  }
});

app.put("/api/cart/update/:productId", isAuthenticated, async (req, res) => {
  const { productId } = req.params;
  const { action } = req.body; 
  try {
    const user = await User.findById(req.session.userId);
    const productIndex = user.cart.findIndex(item => item.id == productId);

    if (productIndex > -1) {
      if (action === "increase") {
        user.cart[productIndex].quanty++;
      } else if (action === "decrease") {
        if (user.cart[productIndex].quanty > 1) {
          user.cart[productIndex].quanty--;
        }
      }
      await user.save();
      res.status(200).json(user.cart);
    } else {
      res.status(404).json({ error: "Producto no encontrado en el carrito." });
    }
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar cantidad." });
  }
});

app.delete("/api/cart/remove/:productId", isAuthenticated, async (req, res) => {
  const { productId } = req.params;
  try {
    const user = await User.findById(req.session.userId);
    user.cart = user.cart.filter(item => item.id != productId);
    await user.save();
    res.status(200).json(user.cart); 
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar producto." });
  }
});

// --- RUTA DE PAGO ---
app.post("/create_preference", isAuthenticated, async (req, res) => {
  const preference = new Preference(client);
  try {
    const user = await User.findById(req.session.userId);
    if (!user.cart || user.cart.length === 0) {
      return res.status(400).json({ error: "El carrito está vacío." });
    }
    
    const items_list = user.cart.map(item => {
      return {
        title: item.productName,
        quantity: Number(item.quanty),
        currency_id: "ARS",
        unit_price: Number(item.price),
      }
    });

    const data = await preference.create({
      body: {
        items: items_list,
        back_urls: {
          success: "http://localhost:8080/feedback", 
          failure: "http://localhost:8080/feedback",
          pending: "http://localhost:8080/feedback",
        },
        auto_return: "approved", 
        payer: {
          email: req.session.userEmail 
        }
      },
    });
    
    res.status(200).json({
      preference_id: data.id,
      preference_url: data.init_point,
    });
  } catch (error) {
    console.error("Error al crear preferencia de MP:", error);
    res.status(500).json({ error: "Error creando la preferencia" });
  }
});

// Iniciar servidor
app.listen(8080, () => {
  console.log("Servidor corriendo en http://localhost:8080 🚀");
});