// CAMBIAR EN PRODUCCIÓN
//const API_URL = "http://localhost:8000"; 
const API_URL = "https://practicarexamenesweb.onrender.com";

const token = localStorage.getItem("token");
const myUsername = localStorage.getItem("username"); // En este examen es el Email

if (!token) window.location.href = "login.html";

document.getElementById("userInfo").innerText = `Usuario: ${myUsername}`;

// Mapa
const map = L.map('map').setView([40.416, -3.703], 4); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let markers = []; // Para los marcadores guardados en BD
let tempMarker = null; // Para el marcador temporal (click)

// 1. CARGAR ITEMS (Míos o de otro)
async function loadItems(ownerEmail = null) {
    // A. Limpiar marcadores viejos guardados
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    // B. Limpiar el marcador temporal si existía
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
        document.getElementById("itemForm").reset();
    }

    let url = `${API_URL}/items`;
    if (ownerEmail) {
        url += `?owner=${ownerEmail}`;
        // UI: Modo Visita 
        document.getElementById("mapTitle").innerText = `Mapa de: ${ownerEmail}`;
        document.getElementById("addFormPanel").classList.add("hidden"); // Ocultar formulario 
        document.getElementById("visitsPanel").classList.add("hidden");  // Ocultar mis visitas
    } else {
        // UI: Modo Mi Mapa
        document.getElementById("mapTitle").innerText = "Mi Mapa";
        document.getElementById("addFormPanel").classList.remove("hidden");
        document.getElementById("visitsPanel").classList.remove("hidden");
        loadVisits(); // Cargar historial de visitas recibidas
    }

    try {
        const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
        if (!res.ok) throw new Error("Error cargando mapa");
        const items = await res.json();

        items.forEach(item => {
            if (item.latitude && item.longitude) {
                // Lógica para mostrar imagen SOLO si existe (Opcional)
                let imageHTML = "";
                if (item.image_url && item.image_url !== "") {
                    imageHTML = `<br><img src="${item.image_url}" width="150" style="margin-top:5px;">`;
                }

                const marker = L.marker([item.latitude, item.longitude])
                    .addTo(map)
                    .bindPopup(`<b>${item.title}</b><br>${item.address}${imageHTML}`);
                markers.push(marker);
            }
        });
    } catch (err) {
        alert("No se pudo cargar el mapa (¿El usuario existe?)");
    }
}

// 2. CARGAR MIS VISITAS RECIBIDAS
async function loadVisits() {
    const res = await fetch(`${API_URL}/my-visits`, { headers: { "Authorization": `Bearer ${token}` } });
    const visits = await res.json();
    const list = document.getElementById("visitsList");
    list.innerHTML = "";
    
    visits.forEach(v => {
        const li = document.createElement("li");
        li.innerText = `📅 ${new Date(v.timestamp).toLocaleString()} - 👤 ${v.visitor}`;
        list.appendChild(li);
    });
}

// 3. FUNCIONES DE BOTONES
function searchUserMap() {
    const email = document.getElementById("searchEmail").value;
    if(email) loadItems(email);
}

function resetMap() {
    document.getElementById("searchEmail").value = "";
    loadItems(); // Carga el mío por defecto
}

// 4. SUBIR NUEVO LUGAR (IMAGEN OPCIONAL)
document.getElementById("itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("title", document.getElementById("title").value);
    formData.append("address", document.getElementById("address").value);
    
    // Solo añadimos el archivo si el usuario ha seleccionado uno
    const fileInput = document.getElementById("file");
    if (fileInput.files.length > 0) {
        formData.append("file", fileInput.files[0]);
    }

    const res = await fetch(`${API_URL}/items`, {
        method: "POST", headers: { "Authorization": `Bearer ${token}` }, body: formData
    });

    if (res.ok) {
        alert("Lugar añadido!");
        // Limpiamos también el marcador temporal al guardar
        if (tempMarker) {
            map.removeLayer(tempMarker);
            tempMarker = null;
        }
        document.getElementById("itemForm").reset();
        loadItems(); // Recargar mi mapa
    } else {
        alert("Error al guardar");
    }
});

function logout() {
    localStorage.clear();
    window.location.href = "login.html";
}

// --- NUEVO: FUNCIONALIDAD CLICK EN MAPA (REVERSE GEOCODING) ---
map.on('click', async function(e) {
    // 1. SEGURIDAD: Si estamos visitando a otro, NO permitir poner marcadores
    if (document.getElementById("addFormPanel").classList.contains("hidden")) {
        return; 
    }

    // 2. Obtener coordenadas del clic
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    // 3. Si ya había uno, lo quitamos para poner el nuevo
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }

    // 4. Creamos el marcador temporal
    tempMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    
    // Feedback visual y funcionalidad de borrar al hacer clic sobre él
    tempMarker.bindPopup("📍 Ubicación seleccionada.<br>Haz clic en mí para deshacer.").openPopup();
    
    tempMarker.on('click', function() {
        map.removeLayer(this);
        tempMarker = null;
        document.getElementById("itemForm").reset();
    });

    // 5. Rellenar input mientras buscamos
    document.getElementById("address").value = "Buscando dirección...";

    // 6. Llamar a la API de Nominatim para obtener la dirección (Reverse Geocoding)
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();

        if (data && data.display_name) {
            // Rellenar el formulario automáticamente
            document.getElementById("address").value = data.display_name;
            
            // Truco extra: Si el campo título está vacío, ponerle la ciudad
            if (document.getElementById("title").value === "") {
                const city = data.address.city || data.address.town || data.address.village || "Ubicación";
                document.getElementById("title").value = city;
            }
        } else {
            document.getElementById("address").value = "Dirección no encontrada, introduce manual";
        }
    } catch (error) {
        console.error("Error en reverse geocoding:", error);
        document.getElementById("address").value = ""; // Limpiar si falla
    }
});

// Inicio
loadItems();