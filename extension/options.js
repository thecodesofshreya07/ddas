const input = document.getElementById("apiBase");
const saveBtn = document.getElementById("save");
const savedMsg = document.getElementById("saved");

async function load() {
  input.value = await getApiBase();
}

saveBtn.onclick = async () => {
  await setApiBase(input.value.trim());
  savedMsg.style.display = "block";
  setTimeout(() => (savedMsg.style.display = "none"), 1500);
};

load();
