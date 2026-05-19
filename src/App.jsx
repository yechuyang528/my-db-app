import { useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { isLoggedIn } from './api';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());

  if (!loggedIn) {
    return <Login onLoginSuccess={() => setLoggedIn(true)} />;
  }
  return <Dashboard onLogout={() => setLoggedIn(false)} />;
}