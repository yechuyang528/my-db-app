import { useState } from 'react';
import { login, register } from '../api';

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      onLoginSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>{mode === 'login' ? '登录' : '注册'}</h1>

        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label}>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              required
              placeholder="example@email.com"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              required
              placeholder="至少6位"
              minLength={6}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? '处理中...' : (mode === 'login' ? '登录' : '注册')}
          </button>
        </form>

        <div style={styles.switch}>
          {mode === 'login' ? (
            <span>还没有账号？<a onClick={() => setMode('register')} style={styles.link}>注册</a></span>
          ) : (
            <span>已有账号？<a onClick={() => setMode('login')} style={styles.link}>登录</a></span>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: 20,
  },
  card: {
    background: 'white',
    padding: 40,
    borderRadius: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    width: '100%',
    maxWidth: 400,
  },
  title: {
    margin: '0 0 30px 0',
    textAlign: 'center',
    color: '#333',
  },
  field: { marginBottom: 20 },
  label: {
    display: 'block',
    marginBottom: 8,
    color: '#555',
    fontSize: 14,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: 12,
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    cursor: 'pointer',
    marginTop: 10,
  },
  error: {
    padding: 10,
    background: '#fee',
    color: '#c33',
    borderRadius: 6,
    marginBottom: 15,
    fontSize: 14,
  },
  switch: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
    color: '#666',
  },
  link: {
    color: '#667eea',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};