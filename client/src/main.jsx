import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell.jsx'
import { DemoProvider, ToastProvider } from './lib/contexts.jsx'
import Capture from './pages/Capture.jsx'
import Dashboard from './pages/Dashboard.jsx'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <DemoProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<Capture />} />
              <Route path="/dashboard" element={<Dashboard />} />
            </Routes>
          </Shell>
        </DemoProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
