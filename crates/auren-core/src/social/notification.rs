//! Best-effort desktop toast. The in-app notification remains available when
//! Windows notifications are disabled or the portable app has no registered AUMID.
use windows::{
    core::HSTRING,
    Data::Xml::Dom::XmlDocument,
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
};
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub fn show(title: &str, body: &str, silent: bool) -> anyhow::Result<bool> {
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)?;
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("app.auren.launcher"))?;
    if notifier.Setting()? != NotificationSetting::Enabled {
        return Ok(false);
    }
    let document = XmlDocument::new()?;
    let audio = if silent {
        "<audio silent=\"true\"/>"
    } else {
        "<audio src=\"ms-winsoundevent:Notification.Default\"/>"
    };
    document.LoadXml(&HSTRING::from(format!("<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{audio}</toast>",escape(title),escape(body))))?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    notifier.Show(&toast)?;
    Ok(true)
}
#[cfg(test)]
mod tests {
    #[test]
    fn peer_text_is_xml_text() {
        assert_eq!(super::escape("<>&\"'"), "&lt;&gt;&amp;&quot;&apos;");
    }
}
