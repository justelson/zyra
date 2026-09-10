import { useLocation } from 'react-router-dom'
import { findSettingsNavigationItem } from './settings-navigation'
import { SettingsCategoryRedirect } from './SettingsRedirect'

// Compatibility for older lazy imports; categories no longer add a landing page.
export default function SettingsOverview() {
    const { pathname } = useLocation()
    return <SettingsCategoryRedirect categoryId={findSettingsNavigationItem(pathname).id} />
}
