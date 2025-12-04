import os
import shutil
from datetime import datetime, timedelta
from typing import List, Optional

# Librerías de FastAPI y Pydantic
from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Librerías de utilidades y seguridad
from jose import JWTError, jwt
from passlib.context import CryptContext
from dotenv import load_dotenv
import pymongo
from bson import ObjectId

# Librerías externas (Mapas y Cloudinary)
import httpx
import cloudinary
import cloudinary.uploader

# --- 1. CONFIGURACIÓN E INICIALIZACIÓN ---

# Cargar variables del .env
load_dotenv(dotenv_path="../.env") # Busca el .env en la carpeta superior

# Configuración Cloudinary
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)

# Configuración Seguridad
SECRET_KEY = os.getenv("SECRET_KEY", "secret")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Conexión MongoDB
MONGO_URI = os.getenv("MONGO_URI")
client = pymongo.MongoClient(MONGO_URI)
db = client["examen_db"] # Nombre de la BD
users_collection = db["users"]
items_collection = db["items"] # Aquí guardaremos los lugares/posts

# Inicializar App
app = FastAPI(title="Examen Backend API")

# Configurar CORS (Permitir que el Frontend hable con el Backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # En producción cambiar por dominio real, para examen "*" está bien
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Herramientas de Password y Auth
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- 2. MODELOS DE DATOS (PYDANTIC) ---

# Modelo para devolver datos de usuario sin password
class UserResponse(BaseModel):
    username: str
    role: str # 'admin' o 'user'

# Modelo para crear items (No se usa en el Body del endpoint porque usaremos Form-Data, pero sirve de referencia)
class ItemResponse(BaseModel):
    id: str
    title: str
    address: str
    image_url: str
    latitude: float
    longitude: float
    owner: str

# --- 3. FUNCIONES AUXILIARES ---

def get_password_hash(password):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# Función para convertir dirección en coordenadas (Geocoding)
async def get_coordinates(address: str):
    async with httpx.AsyncClient() as client:
        # Usamos Nominatim de OpenStreetMap (Gratis)
        url = "https://nominatim.openstreetmap.org/search"
        params = {"q": address, "format": "json", "limit": 1}
        # IMPORTANTE: User-Agent es obligatorio por políticas de OSM
        headers = {"User-Agent": "ExamenIngenieriaWeb/1.0"}
        
        response = await client.get(url, params=params, headers=headers)
        data = response.json()
        
        if data and len(data) > 0:
            return float(data[0]["lat"]), float(data[0]["lon"])
        return 0.0, 0.0 # Si falla, devuelve 0,0

# Helper para arreglar el ObjectId de Mongo a String
def fix_id(doc):
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

# --- 4. DEPENDENCIAS (AUTH) ---

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales invalidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = users_collection.find_one({"username": username})
    if user is None:
        raise credentials_exception
    return user

# --- 5. ENDPOINTS ---

@app.get("/")
def read_root():
    return {"message": "API Examen Funcionando. Ve a /docs para probar"}

# === AUTENTICACIÓN ===

@app.post("/register")
def register(username: str = Form(...), password: str = Form(...), role: str = Form("user")):
    # role puede ser 'user' o 'admin'. En el examen puedes forzar uno manualmente si quieres probar.
    if users_collection.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="El usuario ya existe")
    
    hashed_password = get_password_hash(password)
    user_dict = {
        "username": username,
        "password": hashed_password,
        "role": role 
    }
    users_collection.insert_one(user_dict)
    return {"message": "Usuario creado correctamente"}

@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = users_collection.find_one({"username": form_data.username})
    if not user or not verify_password(form_data.password, user["password"]):
        raise HTTPException(status_code=400, detail="Usuario o contraseña incorrectos")
    
    # IMPORTANTE: Guardamos el rol en el token para usarlo luego en el frontend si hace falta
    access_token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=UserResponse)
def read_users_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(username=current_user["username"], role=current_user["role"])

# === LÓGICA DE NEGOCIO (ITEMS/LUGARES) ===

# GET: Leer items (Cualquier usuario logueado)
@app.get("/items", response_model=List[ItemResponse])
def get_items(current_user: dict = Depends(get_current_user)):
    items = list(items_collection.find())
    return [fix_id(item) for item in items]

# POST: Crear item (SOLO ADMIN O ROL AUTORIZADO)
@app.post("/items")
async def create_item(
    title: str = Form(...),
    address: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    # 1. Verificar Permisos
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para crear (Solo Admins)")

    # 2. Subir imagen a Cloudinary
    try:
        upload_result = cloudinary.uploader.upload(file.file)
        image_url = upload_result.get("secure_url")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error subiendo imagen: {str(e)}")

    # 3. Obtener Coordenadas (Geocoding)
    lat, lon = await get_coordinates(address)

    # 4. Guardar en Mongo
    new_item = {
        "title": title,
        "address": address,
        "image_url": image_url,
        "latitude": lat,
        "longitude": lon,
        "owner": current_user["username"]
    }
    result = items_collection.insert_one(new_item)
    
    # 5. Devolver resultado
    new_item["_id"] = result.inserted_id
    return fix_id(new_item)

# DELETE: Borrar item (SOLO ADMIN)
@app.delete("/items/{item_id}")
def delete_item(item_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="No tienes permisos para borrar")
    
    result = items_collection.delete_one({"_id": ObjectId(item_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    
    return {"message": "Item eliminado correctamente"}