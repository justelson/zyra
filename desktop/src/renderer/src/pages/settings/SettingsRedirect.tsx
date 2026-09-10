import { Navigate, useLocation } from 'react-router-dom'
import { getSettingsCategoryEntry } from './settings-navigation'

export function SettingsCategoryRedirect({ categoryId }: { categoryId: string }) {
    return <SettingsRedirect to={getSettingsCategoryEntry(categoryId).to} />
}

export function SettingsRedirect({ to }: { to: string }) {
    const { search, hash, state } = useLocation()
    return <Navigate to={{ pathname: to, search, hash }} state={state} replace />
}
