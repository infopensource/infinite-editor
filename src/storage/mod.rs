#![cfg_attr(not(feature = "desktop"), allow(dead_code))]

use crate::document::{LayoutDocument, ProjectDocument};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const PACKAGE_FORMAT: &str = "infinite-editor-package";
const PACKAGE_VERSION: u32 = 1;
const MAX_PACKAGE_FILES: usize = 10_000;
const MAX_PACKAGE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum DocumentLocation {
    Loose { markdown_path: PathBuf },
    Package { package_path: PathBuf },
}

impl DocumentLocation {
    pub fn path(&self) -> &Path {
        match self {
            Self::Loose { markdown_path } => markdown_path,
            Self::Package { package_path } => package_path,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoadedDocument {
    pub document: ProjectDocument,
    pub location: DocumentLocation,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PackageManifest {
    format: String,
    version: u32,
    entry: PackageEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PackageEntry {
    document: String,
    layout: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    resources: String,
}

pub fn sidecar_path(markdown_path: &Path) -> PathBuf {
    let stem = markdown_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    markdown_path.with_file_name(format!("{stem}.layout.toml"))
}

pub fn default_assets_path(markdown_path: &Path) -> PathBuf {
    let stem = markdown_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    markdown_path.with_file_name(format!("{stem}.assets"))
}

pub fn open_document(path: &Path) -> Result<LoadedDocument, String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("infdoc"))
    {
        open_package(path)
    } else {
        open_loose(path)
    }
}

pub fn save_document(
    location: &DocumentLocation,
    document: &ProjectDocument,
) -> Result<(), String> {
    match location {
        DocumentLocation::Loose { markdown_path } => save_loose(markdown_path, document),
        DocumentLocation::Package { package_path } => {
            save_package(package_path, document, None, Some(package_path))
        }
    }
}

pub fn save_loose(markdown_path: &Path, document: &ProjectDocument) -> Result<(), String> {
    let mut layout = document.layout.clone();
    prepare_layout_for_source(&mut layout, markdown_path, &document.markdown);
    let layout_source =
        toml::to_string_pretty(&layout).map_err(|error| format!("序列化布局文件失败: {error}"))?;

    atomic_write(markdown_path, document.markdown.as_bytes())?;
    atomic_write(&sidecar_path(markdown_path), layout_source.as_bytes())?;
    Ok(())
}

pub fn save_package(
    package_path: &Path,
    document: &ProjectDocument,
    loose_source: Option<&Path>,
    package_source: Option<&Path>,
) -> Result<(), String> {
    let document_name = loose_source
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .unwrap_or("document.md")
        .to_string();
    let document_stem = Path::new(&document_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let layout_name = format!("{document_stem}.layout.toml");
    let resources_name = format!("{document_stem}.assets");

    validate_package_path(&document_name)?;
    validate_package_path(&layout_name)?;
    validate_package_path(&resources_name)?;

    let mut layout = document.layout.clone();
    layout.document.source = document_name.clone();
    layout.document.source_hash = markdown_hash(&document.markdown);

    let loose_assets = loose_source.map(default_assets_path);
    if loose_assets.as_ref().is_some_and(|path| path.is_dir()) {
        layout.resources.root = resources_name.clone();
    }

    let manifest = PackageManifest {
        format: PACKAGE_FORMAT.to_string(),
        version: PACKAGE_VERSION,
        entry: PackageEntry {
            document: document_name.clone(),
            layout: layout_name.clone(),
            resources: layout.resources.root.clone(),
        },
    };

    let manifest_source =
        toml::to_string_pretty(&manifest).map_err(|error| format!("序列化包清单失败: {error}"))?;
    let layout_source =
        toml::to_string_pretty(&layout).map_err(|error| format!("序列化布局文件失败: {error}"))?;
    let temporary = temporary_sibling(package_path);
    let file = File::create(&temporary).map_err(|error| format!("创建临时包失败: {error}"))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    write_zip_entry(
        &mut writer,
        "manifest.toml",
        manifest_source.as_bytes(),
        options,
    )?;
    write_zip_entry(
        &mut writer,
        &document_name,
        document.markdown.as_bytes(),
        options,
    )?;
    write_zip_entry(&mut writer, &layout_name, layout_source.as_bytes(), options)?;

    if let Some(assets_path) = loose_assets.filter(|path| path.is_dir()) {
        add_directory_to_zip(&mut writer, &assets_path, &resources_name, options)?;
    } else if let Some(source) = package_source.filter(|path| path.exists()) {
        copy_package_resources(&mut writer, source, &layout.resources.root, options)?;
    }

    let file = writer
        .finish()
        .map_err(|error| format!("完成 INFDoc 写入失败: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("同步 INFDoc 到磁盘失败: {error}"))?;
    replace_file(&temporary, package_path)
}

fn open_loose(path: &Path) -> Result<LoadedDocument, String> {
    let markdown =
        std::fs::read_to_string(path).map_err(|error| format!("读取文件失败: {error}"))?;
    let layout_path = sidecar_path(path);
    let mut warnings = Vec::new();
    let mut layout = if layout_path.exists() {
        let source = std::fs::read_to_string(&layout_path)
            .map_err(|error| format!("读取布局文件失败: {error}"))?;
        toml::from_str(&source).map_err(|error| format!("解析布局文件失败: {error}"))?
    } else {
        warnings.push("未找到同名布局文件，已使用默认布局".to_string());
        LayoutDocument::default()
    };
    warnings.extend(layout.validate_and_normalize()?);
    warn_if_hash_mismatch(&layout, &markdown, &mut warnings);

    Ok(LoadedDocument {
        document: ProjectDocument { markdown, layout },
        location: DocumentLocation::Loose {
            markdown_path: path.to_path_buf(),
        },
        warnings,
    })
}

fn open_package(path: &Path) -> Result<LoadedDocument, String> {
    let file = File::open(path).map_err(|error| format!("打开 INFDoc 失败: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("读取 INFDoc 失败: {error}"))?;
    validate_archive(&mut archive)?;
    let manifest_source = read_zip_text(&mut archive, "manifest.toml")?;
    let manifest: PackageManifest = toml::from_str(&manifest_source)
        .map_err(|error| format!("解析 INFDoc 清单失败: {error}"))?;
    if manifest.format != PACKAGE_FORMAT || manifest.version != PACKAGE_VERSION {
        return Err(format!(
            "不支持的 INFDoc 格式或版本：{} v{}",
            manifest.format, manifest.version
        ));
    }
    validate_package_path(&manifest.entry.document)?;
    validate_package_path(&manifest.entry.layout)?;
    if !manifest.entry.resources.is_empty() {
        validate_package_path(&manifest.entry.resources)?;
    }

    let markdown = read_zip_text(&mut archive, &manifest.entry.document)?;
    let layout_source = read_zip_text(&mut archive, &manifest.entry.layout)?;
    let mut layout: LayoutDocument =
        toml::from_str(&layout_source).map_err(|error| format!("解析包内布局文件失败: {error}"))?;
    let mut warnings = layout.validate_and_normalize()?;
    warn_if_hash_mismatch(&layout, &markdown, &mut warnings);

    Ok(LoadedDocument {
        document: ProjectDocument { markdown, layout },
        location: DocumentLocation::Package {
            package_path: path.to_path_buf(),
        },
        warnings,
    })
}

fn prepare_layout_for_source(layout: &mut LayoutDocument, path: &Path, markdown: &str) {
    layout.document.source = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.md")
        .to_string();
    layout.document.source_hash = markdown_hash(markdown);
    if layout.resources.root.is_empty() {
        layout.resources.root = default_assets_path(path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document.assets")
            .to_string();
    }
}

fn markdown_hash(markdown: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(markdown.as_bytes()))
}

fn warn_if_hash_mismatch(layout: &LayoutDocument, markdown: &str, warnings: &mut Vec<String>) {
    if !layout.document.source_hash.is_empty()
        && layout.document.source_hash != markdown_hash(markdown)
    {
        warnings
            .push("布局文件记录的 Markdown 摘要与当前内容不一致，布局可能来自较早版本".to_string());
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = temporary_sibling(path);
    let mut file =
        File::create(&temporary).map_err(|error| format!("创建临时文件失败: {error}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("写入临时文件失败: {error}"))?;
    replace_file(&temporary, path)
}

fn temporary_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    path.with_file_name(format!(".{name}.{}.tmp", std::process::id()))
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(temporary, destination).map_err(|error| format!("提交文件失败: {error}"))
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return std::fs::rename(temporary, destination)
            .map_err(|error| format!("提交文件失败: {error}"));
    }
    let backup = destination.with_extension("infinite-editor-backup");
    std::fs::rename(destination, &backup).map_err(|error| format!("备份旧文件失败: {error}"))?;
    if let Err(error) = std::fs::rename(temporary, destination) {
        let _ = std::fs::rename(&backup, destination);
        return Err(format!("提交文件失败: {error}"));
    }
    let _ = std::fs::remove_file(backup);
    Ok(())
}

fn write_zip_entry<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    name: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<(), String> {
    writer
        .start_file(name, options)
        .and_then(|_| writer.write_all(bytes).map_err(Into::into))
        .map_err(|error: zip::result::ZipError| format!("写入 INFDoc 条目 {name} 失败: {error}"))
}

fn add_directory_to_zip<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    directory: &Path,
    archive_root: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in
        std::fs::read_dir(directory).map_err(|error| format!("读取资源目录失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取资源条目失败: {error}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let archive_name = format!("{archive_root}/{name}");
        validate_package_path(&archive_name)?;
        if path.is_dir() {
            add_directory_to_zip(writer, &path, &archive_name, options)?;
        } else if path.is_file() {
            let bytes = std::fs::read(&path)
                .map_err(|error| format!("读取资源 {} 失败: {error}", path.display()))?;
            write_zip_entry(writer, &archive_name, &bytes, options)?;
        }
    }
    Ok(())
}

fn copy_package_resources<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    source_package: &Path,
    resources_root: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    if resources_root.is_empty() {
        return Ok(());
    }
    validate_package_path(resources_root)?;
    let file =
        File::open(source_package).map_err(|error| format!("读取原 INFDoc 资源失败: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("读取原 INFDoc 失败: {error}"))?;
    validate_archive(&mut archive)?;
    let prefix = format!("{}/", resources_root.trim_end_matches('/'));
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取原 INFDoc 资源失败: {error}"))?;
        let name = entry.name().to_string();
        if entry.is_dir() || !name.starts_with(&prefix) {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| format!("读取包内资源 {name} 失败: {error}"))?;
        write_zip_entry(writer, &name, &bytes, options)?;
    }
    Ok(())
}

fn read_zip_text<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<String, String> {
    let mut file = archive
        .by_name(name)
        .map_err(|error| format!("INFDoc 缺少 {name}: {error}"))?;
    if file.size() > MAX_PACKAGE_FILE_BYTES {
        return Err(format!("INFDoc 条目 {name} 超过大小限制"));
    }
    let mut source = String::new();
    file.read_to_string(&mut source)
        .map_err(|error| format!("读取 INFDoc 条目 {name} 失败: {error}"))?;
    Ok(source)
}

fn validate_archive<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<(), String> {
    if archive.len() > MAX_PACKAGE_FILES {
        return Err("INFDoc 包含的文件数量超过限制".to_string());
    }
    let mut total = 0u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| format!("检查 INFDoc 条目失败: {error}"))?;
        if file.enclosed_name().is_none() || file.is_symlink() {
            return Err(format!("INFDoc 包含不安全路径：{}", file.name()));
        }
        if file.size() > MAX_PACKAGE_FILE_BYTES {
            return Err(format!("INFDoc 条目过大：{}", file.name()));
        }
        total = total.saturating_add(file.size());
        if total > MAX_PACKAGE_TOTAL_BYTES {
            return Err("INFDoc 解压后总大小超过限制".to_string());
        }
    }
    Ok(())
}

fn validate_package_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.contains('\\') {
        return Err(format!("无效的包内路径：{path}"));
    }
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("不安全的包内路径：{path}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间应有效")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("infinite-editor-{suffix}"));
        std::fs::create_dir_all(&path).expect("应创建测试目录");
        path
    }

    #[test]
    fn loose_document_saves_and_restores_layout() {
        let directory = test_directory();
        let path = directory.join("proposal.md");
        let mut document = ProjectDocument::new("# 标题".to_string());
        document.layout.paper.mode = crate::document::PaperMode::Custom;
        document.layout.paper.width_mm = 180.0;
        document.layout.margins.left_mm = 16.0;

        save_loose(&path, &document).expect("应保存松散文档");
        let loaded = open_document(&path).expect("应打开松散文档");

        assert_eq!(loaded.document.markdown, "# 标题");
        assert_eq!(loaded.document.layout.paper.width_mm, 180.0);
        assert_eq!(loaded.document.layout.margins.left_mm, 16.0);
        assert!(sidecar_path(&path).exists());
        std::fs::remove_dir_all(directory).expect("应清理测试目录");
    }

    #[test]
    fn infdoc_round_trip_preserves_document_and_layout() {
        let directory = test_directory();
        let loose_path = directory.join("proposal.md");
        let package_path = directory.join("proposal.infdoc");
        let assets_path = directory.join("proposal.assets");
        std::fs::create_dir_all(&assets_path).expect("应创建资源目录");
        std::fs::write(assets_path.join("cover.png"), b"fake-png").expect("应创建测试资源");
        let mut document = ProjectDocument::new("# 可移植文档".to_string());
        document.layout.paper.mode = crate::document::PaperMode::A5;

        save_package(&package_path, &document, Some(&loose_path), None).expect("应创建 INFDoc");
        let mut loaded = open_document(&package_path).expect("应打开 INFDoc");

        assert_eq!(loaded.document.markdown, document.markdown);
        assert_eq!(loaded.document.layout.paper, document.layout.paper);
        assert!(matches!(loaded.location, DocumentLocation::Package { .. }));

        loaded.document.markdown.push_str("\n\n正文");
        save_document(&loaded.location, &loaded.document).expect("重新保存不应丢失包内资源");
        let file = File::open(&package_path).expect("应打开生成的包");
        let mut archive = ZipArchive::new(file).expect("应读取生成的包");
        let mut resource = Vec::new();
        archive
            .by_name("proposal.assets/cover.png")
            .expect("包内资源应被保留")
            .read_to_end(&mut resource)
            .expect("应读取包内资源");
        assert_eq!(resource, b"fake-png");
        std::fs::remove_dir_all(directory).expect("应清理测试目录");
    }

    #[test]
    fn package_paths_cannot_escape_archive_root() {
        assert!(validate_package_path("assets/image.png").is_ok());
        assert!(validate_package_path("../secret.txt").is_err());
        assert!(validate_package_path("/etc/passwd").is_err());
        assert!(validate_package_path("assets\\image.png").is_err());
    }
}
