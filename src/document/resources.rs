use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceBundle {
    entries: BTreeMap<String, String>,
}

impl ResourceBundle {
    pub fn insert(&mut self, path: String, data_url: String) {
        self.entries
            .insert(normalize_resource_path(&path), data_url);
    }

    pub fn entries(&self) -> &BTreeMap<String, String> {
        &self.entries
    }

    pub fn get(&self, path: &str) -> Option<&str> {
        self.entries
            .get(&normalize_resource_path(path))
            .map(String::as_str)
    }
}

fn normalize_resource_path(path: &str) -> String {
    path.trim_start_matches("./").replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_keys_are_normalized_for_markdown_urls() {
        let mut bundle = ResourceBundle::default();
        bundle.insert(
            "./proposal.assets\\cover.png".into(),
            "data:image/png;base64,AA==".into(),
        );

        assert!(bundle.entries().contains_key("proposal.assets/cover.png"));
    }
}
