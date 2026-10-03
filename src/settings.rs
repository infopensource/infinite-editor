//! Device preferences, independent of document layout and build configuration.
use std::path::{Path, PathBuf};

pub fn path() -> Result<PathBuf, String> {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .filter(|value| Path::new(value).is_absolute())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    };
    base.map(|base| base.join("infinite-editor/settings.toml"))
        .ok_or_else(|| "无法确定用户配置目录".into())
}

fn read(path: &Path) -> Result<Option<toml::Table>, String> {
    match std::fs::read_to_string(path) {
        Ok(source) => source
            .parse::<toml::Table>()
            .map(Some)
            .map_err(|error| format!("{}：{error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}：{error}", path.display())),
    }
}

fn style(table: &toml::Table) -> Result<bool, String> {
    let Some(appearance) = table.get("appearance") else {
        return Ok(false);
    };
    let appearance = appearance.as_table().ok_or("appearance 必须是配置表")?;
    match appearance.get("dialog_style") {
        None => Ok(false),
        Some(toml::Value::String(value)) if value == "a" => Ok(false),
        Some(toml::Value::String(value)) if value == "b" => Ok(true),
        _ => Err("appearance.dialog_style 必须为 \"a\" 或 \"b\"".into()),
    }
}

/// None means first launch: migrate the previous WebView preference.
pub fn load() -> Result<Option<bool>, String> {
    read(&path()?)?.as_ref().map(style).transpose()
}

pub fn save(style_b: bool) -> Result<(), String> {
    save_to(&path()?, style_b)
}

fn save_to(path: &Path, style_b: bool) -> Result<(), String> {
    let mut table = read(path)?.unwrap_or_default();
    // Do not silently overwrite malformed settings; retain unknown fields.
    style(&table)?;
    let appearance = table
        .entry("appearance")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    appearance
        .as_table_mut()
        .ok_or("appearance 必须是配置表")?
        .insert(
            "dialog_style".into(),
            toml::Value::String(if style_b { "b" } else { "a" }.into()),
        );
    let source = toml::to_string_pretty(&table).map_err(|error| error.to_string())?;
    let parent = path.parent().ok_or("配置文件缺少父目录")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("toml.tmp");
    std::fs::write(&temporary, source).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_round_trip_and_preserve_unknown_fields() {
        let directory =
            std::env::temp_dir().join(format!("infinite-settings-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("settings.toml");
        assert!(read(&path).unwrap().is_none());
        save_to(&path, true).unwrap();
        assert!(style(&read(&path).unwrap().unwrap()).unwrap());
        std::fs::write(&path, "custom = 42\n[appearance]\ndialog_style = 'b'\n").unwrap();
        save_to(&path, false).unwrap();
        let table = read(&path).unwrap().unwrap();
        assert!(!style(&table).unwrap());
        assert_eq!(table["custom"].as_integer(), Some(42));
        for invalid in ["broken = [", "[appearance]\ndialog_style = 'invalid'\n"] {
            std::fs::write(&path, invalid).unwrap();
            assert!(save_to(&path, true).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), invalid);
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
