#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
}

impl ThemeMode {
    pub fn key(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    #[cfg(feature = "desktop")]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemePreset {
    Office,
    ClassicBlue,
    Forest,
    Plum,
    Custom,
}

impl ThemePreset {
    pub const PRESETS: [Self; 4] = [Self::Office, Self::ClassicBlue, Self::Forest, Self::Plum];

    pub fn key(self) -> &'static str {
        match self {
            Self::Office => "office",
            Self::ClassicBlue => "classic-blue",
            Self::Forest => "forest",
            Self::Plum => "plum",
            Self::Custom => "custom",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Office => "默认白色",
            Self::ClassicBlue => "经典蓝色",
            Self::Forest => "森林绿",
            Self::Plum => "暮光紫",
            Self::Custom => "自定义",
        }
    }

    pub fn color(self) -> &'static str {
        match self {
            Self::Office => "#3978ad",
            Self::ClassicBlue => "#244f77",
            Self::Forest => "#2d7057",
            Self::Plum => "#70548d",
            Self::Custom => "#3978ad",
        }
    }

    #[cfg(feature = "desktop")]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "office" => Some(Self::Office),
            "classic-blue" => Some(Self::ClassicBlue),
            "forest" => Some(Self::Forest),
            "plum" => Some(Self::Plum),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ThemeSettings {
    pub mode: ThemeMode,
    pub preset: ThemePreset,
    pub custom_color: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            mode: ThemeMode::Light,
            preset: ThemePreset::Office,
            custom_color: "#3978ad".into(),
        }
    }
}

impl ThemeSettings {
    pub fn valid_color(value: &str) -> bool {
        value.len() == 7
            && value.starts_with('#')
            && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    }

    pub fn class(&self) -> String {
        format!("theme-{} theme-{}", self.mode.key(), self.preset.key())
    }

    pub fn style(&self) -> String {
        let color = if Self::valid_color(&self.custom_color) {
            self.custom_color.as_str()
        } else {
            "#3978ad"
        };
        let channels =
            [1, 3, 5].map(|index| u8::from_str_radix(&color[index..index + 2], 16).unwrap_or(0));
        let brightness = (u32::from(channels[0]) * 299
            + u32::from(channels[1]) * 587
            + u32::from(channels[2]) * 114)
            / 1000;
        let foreground = if brightness > 155 {
            "#182635"
        } else {
            "#ffffff"
        };
        let blend = |base: [u8; 3], amount: u32| {
            let channels = [0, 1, 2].map(|index| {
                (u32::from(channels[index]) * amount + u32::from(base[index]) * (100 - amount) + 50)
                    / 100
            });
            format!("#{:02x}{:02x}{:02x}", channels[0], channels[1], channels[2])
        };
        format!(
            "--ie-custom-color: {color}; --ie-custom-on-color: {foreground}; \
             --ie-custom-accent: {}; --ie-custom-soft: {}; --ie-custom-strong: {}; \
             --ie-custom-dark-title: {}; --ie-custom-dark-accent: {}; --ie-custom-dark-soft: {}",
            blend([0x20, 0x47, 0x66], 60),
            blend([0xff, 0xff, 0xff], 16),
            blend([0x17, 0x33, 0x48], 35),
            blend([0x20, 0x2a, 0x35], 24),
            blend([0xb9, 0xd9, 0xee], 55),
            blend([0x20, 0x2a, 0x35], 26),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_colors_are_validated_and_keep_title_text_readable() {
        assert!(ThemeSettings::valid_color("#ffffff"));
        assert!(!ThemeSettings::valid_color("red"));
        let mut theme = ThemeSettings {
            custom_color: "#ffffff".into(),
            ..Default::default()
        };
        assert!(theme.style().contains("--ie-custom-on-color: #182635"));
        theme.custom_color = "#203040".into();
        assert!(theme.style().contains("--ie-custom-on-color: #ffffff"));
        theme.mode = ThemeMode::Dark;
        theme.preset = ThemePreset::Custom;
        let stored = serde_json::to_string(&theme).unwrap();
        assert_eq!(
            serde_json::from_str::<ThemeSettings>(&stored).unwrap(),
            theme
        );
    }
}
