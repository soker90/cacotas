import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Inicio', icon: '🏠', end: true },
  { to: '/inventory', label: 'Inventario', icon: '📦', end: false },
  { to: '/history', label: 'Historial', icon: '📜', end: false },
  { to: '/stats', label: 'Datos', icon: '📊', end: false },
  { to: '/settings', label: 'Ajustes', icon: '⚙️', end: false },
]

export const AppLayout = () => (
  <>
    <Outlet />
    <nav className='bottom-nav' aria-label='Principal'>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          <span aria-hidden='true'>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  </>
)
