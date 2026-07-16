# DeepCode

DeepCode is a modern, real-time web-based code editor built to deliver a seamless developer experience. By Day 1, the project establishes a robust full-stack architecture featuring a high-performance frontend editor and a real-time enabled backend server, setting the stage for advanced AI code generation and collaborative features.

---

## 🛠️ Tech Stack

### Frontend
* **React + Vite:** For a highly responsive, blazing-fast user interface.
* **Monaco Editor:** The industry-standard code editing engine powering VS Code, providing syntax highlighting and auto-completion.
* **Lucide React:** Clean and consistent modern iconography.
* **Axios:** For handling HTTP requests to the backend API.

### Backend
* **Node.js & Express:** Lightweight, scalable server architecture.
* **Socket.io:** Enabled for low-latency, real-time bi-directional communication.

---

🚀 Getting Started
Follow these steps to spin up the local development environment.

Prerequisites
Ensure you have Node.js installed (v18+ recommended).

1. Backend Setup
Navigate to the backend directory, install the required packages, and fire up the server
```
# Navigate to the backend folder
cd deepcode-backend

# Install backend dependencies (Express, Axios, Socket.io, etc.)
npm install

# Start the backend server
npm start
```

2. Frontend Setup
Open a new terminal window, navigate to the frontend directory, and launch the Vite development server:

```
Bash
# Navigate to the frontend folder
cd deepcode-frontend

# Install frontend dependencies (Vite, React, Monaco Editor, Lucide, etc.)
npm install

# Start the Vite development server
npm run dev
```
