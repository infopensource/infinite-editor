//! Convert external documents into an unsaved editor document.

use crate::document::ProjectDocument;
use std::path::Path;

pub fn import_document(path: &Path) -> Result<ProjectDocument, String> {
    let markdown = anydoc::to_markdown(path).map_err(|error| match error {
        anydoc::ConvertError::NeedsOcr { .. } => {
            "该 PDF 只有扫描图像，AnyDoc 本地导入需要可提取的文字".to_string()
        }
        other => format!("导入文档失败：{other}"),
    })?;
    if markdown.trim().is_empty() {
        return Err("文档中没有可导入的文字".to_string());
    }
    let mut document = ProjectDocument::new(markdown);
    document.layout.document.title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("导入文档")
        .to_string();
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_csv_as_unsaved_markdown() {
        let path = std::env::temp_dir().join(format!("anydoc-import-{}.csv", std::process::id()));
        std::fs::write(&path, "name,value\nalpha,42\n").unwrap();
        let document = import_document(&path).unwrap();
        assert!(document.markdown.contains("alpha"));
        assert_eq!(
            document.layout.document.title,
            path.file_stem().unwrap().to_str().unwrap()
        );
        std::fs::remove_file(path).unwrap();
    }
}
