const API_URL = "http://localhost:8000"; // IMPORTANTE: CAMBIAR ESTO EL DÍA DEL EXAMEN SI ESTAS EN RENDER

// 1. Verificar Autenticación al inicio
const token = localStorage.getItem("token");
const role = localStorage.getItem("role");
const username = localStorage.getItem("username");

if (!token) {
  window.location.href = "login.html";
}

// Mostrar panel de admin solo si es admin
document.getElementById(
  "userInfo"
).innerText = `Logueado como: ${username} (${role})`;
if (role === "admin") {
  document.getElementById("adminPanel").classList.remove("hidden");
}

// 2. Inicializar Mapa (Leaflet)
// Coordenadas iniciales (Centro de España o tu ciudad)
const map = L.map("map").setView([40.416, -3.703], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

// 3. Función para Cargar Items (GET)
async function loadItems() {
  try {
    const res = await fetch(`${API_URL}/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) logout(); // Token expirado

    const items = await res.json();
    const listContainer = document.getElementById("items-list");
    listContainer.innerHTML = ""; // Limpiar lista anterior

    items.forEach((item) => {
      // A. Añadir marcador al mapa
      if (item.latitude && item.longitude) {
        L.marker([item.latitude, item.longitude])
          .addTo(map)
          .bindPopup(
            `<b>${item.title}</b><br><img src="${item.image_url}" width="100">`
          );
      }

      // B. Crear tarjeta en la lista HTML
      const card = document.createElement("div");
      card.className = "item-card";

      // Botón eliminar solo para admins
      let deleteBtn = "";
      if (role === "admin") {
        deleteBtn = `<button class="delete-btn" onclick="deleteItem('${item.id}')">Borrar</button>`;
      }

      card.innerHTML = `
                <img src="${item.image_url}" alt="Imagen">
                <div>
                    <h4>${item.title}</h4>
                    <p>📍 ${item.address}</p>
                    <small>Subido por: ${item.owner}</small>
                    <br><br>
                    ${deleteBtn}
                </div>
            `;
      listContainer.appendChild(card);
    });
  } catch (err) {
    console.error("Error cargando items", err);
  }
}

// 4. Función para Crear Item (POST)
document.getElementById("itemForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = document.getElementById("title").value;
  const address = document.getElementById("address").value;
  const fileInput = document.getElementById("file");

  const formData = new FormData();
  formData.append("title", title);
  formData.append("address", address);
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch(`${API_URL}/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }, // Importante: Bearer Token
      body: formData,
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.detail || "Error al subir");
    }

    alert("Lugar guardado y geolocalizado!");
    document.getElementById("itemForm").reset();
    loadItems(); // Recargar mapa y lista
  } catch (err) {
    alert("Error: " + err.message);
  }
});

// 5. Función para Borrar Item (DELETE)
window.deleteItem = async (id) => {
  if (!confirm("¿Seguro que quieres borrarlo?")) return;

  try {
    const res = await fetch(`${API_URL}/items/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      alert("Eliminado");
      location.reload(); // Recarga simple para limpiar marcadores del mapa
    } else {
      alert("No se pudo eliminar");
    }
  } catch (err) {
    console.error(err);
  }
};

// 6. Logout
window.logout = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("username");
  window.location.href = "login.html";
};

// Cargar al iniciar
loadItems();
