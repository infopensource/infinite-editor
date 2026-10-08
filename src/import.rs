//! Convert external documents into an unsaved editor document.

use crate::document::ProjectDocument;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq)]
pub enum StartupDocument {
    Open(PathBuf),
    Import(PathBuf),
}

pub fn startup_document() -> Result<Option<StartupDocument>, String> {
    std::env::args_os()
        .nth(1)
        .map(|arg| classify_startup_path(PathBuf::from(arg)))
        .transpose()
}

pub fn classify_startup_path(path: PathBuf) -> Result<StartupDocument, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "infdoc" | "idoc" | "md" | "markdown" | "mdown" | "mkd" | "txt" => {
            Ok(StartupDocument::Open(path))
        }
        "doc" | "docx" | "docm" | "ppt" | "pps" | "pot" | "pptx" | "pptm" | "ppsx" | "ppsm"
        | "xls" | "xlsx" | "xlsm" | "xlsb" | "odt" | "ods" | "odp" | "rtf" | "epub" | "csv"
        | "pdf" => Ok(StartupDocument::Import(path)),
        _ => Err(format!("不支持打开此文件：{}", path.display())),
    }
}

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
    fn classifies_explorer_files_for_open_or_import() {
        assert_eq!(
            classify_startup_path(PathBuf::from("报告.MD")).unwrap(),
            StartupDocument::Open(PathBuf::from("报告.MD"))
        );
        assert_eq!(
            classify_startup_path(PathBuf::from("report.PDF")).unwrap(),
            StartupDocument::Import(PathBuf::from("report.PDF"))
        );
        assert_eq!(
            classify_startup_path(PathBuf::from("draft.infdoc")).unwrap(),
            StartupDocument::Open(PathBuf::from("draft.infdoc"))
        );
        assert_eq!(
            classify_startup_path(PathBuf::from("letter.docx")).unwrap(),
            StartupDocument::Import(PathBuf::from("letter.docx"))
        );
        assert!(classify_startup_path(PathBuf::from("unknown.png")).is_err());
    }

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
