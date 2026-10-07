//! Native Office layout: text stays text; header/footer fields stay fields.
use crate::document::{LayoutDocument, PageField, PageRegion, PageTextMark};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use quick_xml::{events::Event, Reader};
use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

type Parts = BTreeMap<String, Vec<u8>>;

pub(super) fn apply(
    path: &Path,
    layout: &LayoutDocument,
    docx: bool,
    page_count: usize,
) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let mut parts = Parts::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if !entry.is_dir() {
            parts.insert(entry.name().into(), bytes);
        }
    }
    if docx {
        apply_docx(&mut parts, layout, page_count)?;
    } else {
        apply_odt(&mut parts, layout, page_count)?;
    }
    let file = std::fs::File::create(path).map_err(|error| error.to_string())?;
    let mut writer = ZipWriter::new(file);
    if let Some(mimetype) = parts.remove("mimetype") {
        writer
            .start_file(
                "mimetype",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(|error| error.to_string())?;
        writer
            .write_all(&mimetype)
            .map_err(|error| error.to_string())?;
    }
    for (name, bytes) in parts {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .map_err(|error| error.to_string())?;
        writer
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
    }
    writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn xml(parts: &Parts, name: &str) -> Result<String, String> {
    String::from_utf8(
        parts
            .get(name)
            .ok_or_else(|| format!("Office 包缺少 {name}"))?
            .clone(),
    )
    .map_err(|error| error.to_string())
}

/// Match actual XML element boundaries, including self-closing elements.
fn span(source: &str, name: &str) -> Result<Option<(usize, usize)>, String> {
    let mut reader = Reader::from_str(source);
    let mut start = None;
    let mut depth = 0;
    loop {
        let before = reader.buffer_position() as usize;
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(element) => {
                if start.is_none() && element.name().as_ref() == name.as_bytes() {
                    start = Some(before);
                }
                if start.is_some() {
                    depth += 1;
                }
            }
            Event::Empty(element)
                if start.is_none() && element.name().as_ref() == name.as_bytes() =>
            {
                return Ok(Some((before, reader.buffer_position() as usize)))
            }
            Event::End(_) if start.is_some() => {
                depth -= 1;
                if depth == 0 {
                    return Ok(Some((start.unwrap(), reader.buffer_position() as usize)));
                }
            }
            Event::Eof => return Ok(None),
            _ => {}
        }
    }
}

fn replace(source: &mut String, name: &str, replacement: &str) -> Result<(), String> {
    let (start, end) = span(source, name)?.ok_or_else(|| format!("Office XML 缺少 {name}"))?;
    source.replace_range(start..end, replacement);
    Ok(())
}

fn insert(source: &mut String, closing: &str, content: &str) -> Result<(), String> {
    let position = source
        .rfind(closing)
        .ok_or_else(|| format!("Office XML 缺少 {closing}"))?;
    source.insert_str(position, content);
    Ok(())
}

fn twips(mm: f32) -> i32 {
    (mm * 1440.0 / 25.4).round() as i32
}
fn emu(mm: f32) -> i64 {
    (mm as f64 * 36000.0).round() as i64
}

fn font(value: &str) -> String {
    if !["system-ui", "sans-serif", "serif", "monospace"].contains(&value) {
        return value.into();
    }
    #[cfg(target_os = "linux")]
    if let Ok(output) = std::process::Command::new("fc-match")
        .args(["-f", "%{family}", value])
        .output()
    {
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout)
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    if value == "monospace" {
        "Courier New".into()
    } else if value == "serif" {
        "Times New Roman".into()
    } else {
        "Arial".into()
    }
}

fn marks(field: &PageField, region: &PageRegion) -> Vec<PageTextMark> {
    let marks = match field {
        PageField::Text { marks, .. } | PageField::Page { marks } | PageField::Pages { marks } => {
            marks.clone()
        }
        _ => vec![],
    };
    if !marks.is_empty() {
        return marks;
    }
    [
        (region.style.bold, PageTextMark::Bold),
        (region.style.italic, PageTextMark::Italic),
        (region.style.underline, PageTextMark::Underline),
        (region.style.strikethrough, PageTextMark::Strikethrough),
    ]
    .into_iter()
    .filter_map(|(enabled, mark)| enabled.then_some(mark))
    .collect()
}

fn decode_image(src: &str) -> Result<(&str, Vec<u8>), String> {
    let (header, encoded) = src.split_once(";base64,").ok_or("页眉页脚图片格式无效")?;
    let extension = match header {
        "data:image/png" => "png",
        "data:image/jpeg" => "jpg",
        "data:image/gif" => "gif",
        "data:image/webp" => "webp",
        _ => return Err("页眉页脚图片格式不受支持".into()),
    };
    Ok((
        extension,
        BASE64.decode(encoded).map_err(|error| error.to_string())?,
    ))
}

fn run_properties(field: &PageField, region: &PageRegion) -> String {
    let mut props = format!("<w:rFonts w:ascii=\"{0}\" w:hAnsi=\"{0}\" w:eastAsia=\"{0}\" w:cs=\"{0}\"/><w:sz w:val=\"{1}\"/><w:szCs w:val=\"{1}\"/><w:color w:val=\"{2}\"/>", escape(&font(&region.style.font_family)), (region.style.font_size_pt * 2.0).round() as i32, &region.style.color[1..]);
    for mark in marks(field, region) {
        props.push_str(match mark {
            PageTextMark::Bold => "<w:b/>",
            PageTextMark::Italic => "<w:i/>",
            PageTextMark::Underline => "<w:u w:val=\"single\"/>",
            PageTextMark::Strikethrough => "<w:strike/>",
        });
    }
    format!("<w:rPr>{props}</w:rPr>")
}

fn picture(rel: &str, id: usize, alt: &str, width: f32, height: f32) -> String {
    let (cx, cy) = (emu(width), emu(height));
    format!(
        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{id}" name="Header image {id}" descr="{}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
        escape(alt)
    )
}

fn docx_region(
    parts: &mut Parts,
    layout: &LayoutDocument,
    kind: &str,
    region: &PageRegion,
    page_count: usize,
) -> Result<(), String> {
    let style = &region.style;
    let margins = &layout.margins;
    let left = style.margin_left_mm.unwrap_or(margins.left_mm);
    let right = style.margin_right_mm.unwrap_or(margins.right_mm);
    let width = layout
        .paper
        .resolved_width_mm()
        .ok_or("Office 导出需要固定纸张")?
        - left
        - right;
    let cell_width =
        (width - style.padding_left_mm - style.padding_right_mm - 2.0 * style.column_gap_mm) / 3.0;
    let region_height = if kind == "header" {
        margins.top_mm
    } else {
        margins.bottom_mm
    } - style.margin_top_mm
        - style.margin_bottom_mm;
    let color = &style.color[1..];
    let border = if style.separator {
        format!(
            "<w:{} w:val=\"single\" w:sz=\"4\" w:color=\"{color}\"/>",
            if kind == "header" { "bottom" } else { "top" }
        )
    } else {
        String::new()
    };
    let mut table = format!(
        r#"<w:tbl><w:tblPr><w:tblW w:w="{}" w:type="dxa"/><w:tblInd w:w="{}" w:type="dxa"/><w:tblBorders>{border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="{}" w:type="dxa"/><w:bottom w:w="{}" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>"#,
        twips(width),
        twips(left - margins.left_mm),
        twips(style.padding_top_mm),
        twips(style.padding_bottom_mm)
    );
    // Five columns implement the three content slots plus two real gaps.
    let widths = [
        cell_width + style.padding_left_mm,
        style.column_gap_mm,
        cell_width,
        style.column_gap_mm,
        cell_width + style.padding_right_mm,
    ];
    for column in widths {
        table.push_str(&format!("<w:gridCol w:w=\"{}\"/>", twips(column)));
    }
    table.push_str(&format!(
        "</w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"{}\" w:hRule=\"exact\"/></w:trPr>",
        twips(region_height)
    ));
    let mut relationships = String::new();
    let mut image_id = 0;
    for (index, fields) in [
        Some(&region.left),
        None,
        Some(&region.center),
        None,
        Some(&region.right),
    ]
    .into_iter()
    .enumerate()
    {
        let alignment = ["left", "left", "center", "left", "right"][index];
        table.push_str(&format!("<w:tc><w:tcPr><w:tcW w:w=\"{}\" w:type=\"dxa\"/><w:vAlign w:val=\"{}\"/>{}</w:tcPr><w:p><w:pPr><w:jc w:val=\"{alignment}\"/><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"{}\" w:lineRule=\"exact\"/></w:pPr>", twips(widths[index]), if kind == "header" { "bottom" } else { "top" }, if index == 0 { format!("<w:tcMar><w:left w:w=\"{}\" w:type=\"dxa\"/></w:tcMar>", twips(style.padding_left_mm)) } else if index == 4 { format!("<w:tcMar><w:right w:w=\"{}\" w:type=\"dxa\"/></w:tcMar>",twips(style.padding_right_mm)) } else { String::new() }, (style.font_size_pt * 1.3 * 20.0).round() as i32));
        if let Some(fields) = fields {
            for field in fields {
                let props = run_properties(field, region);
                match field {
                    PageField::Text { value, .. } => table.push_str(&format!(
                        "<w:r>{props}<w:t xml:space=\"preserve\">{}</w:t></w:r>",
                        escape(value)
                    )),
                    PageField::Page { .. } | PageField::Pages { .. } => {
                        table.push_str(&format!(
                        "<w:fldSimple w:instr=\"{}\"><w:r>{props}<w:t>{}</w:t></w:r></w:fldSimple>",
                        if matches!(field, PageField::Page { .. }) {
                            "PAGE"
                        } else {
                            "NUMPAGES"
                        },
                        if matches!(field, PageField::Pages { .. }) { page_count } else { 1 },
                    ))
                    }
                    PageField::Image {
                        src,
                        alt,
                        width_mm,
                        height_mm,
                    } => {
                        image_id += 1;
                        let (extension, bytes) = decode_image(src)?;
                        let name = format!("infinite-{kind}-{image_id}.{extension}");
                        parts.insert(format!("word/media/{name}"), bytes);
                        relationships.push_str(&format!("<Relationship Id=\"rId{image_id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/{name}\"/>"));
                        table.push_str(&picture(
                            &format!("rId{image_id}"),
                            image_id,
                            alt,
                            *width_mm,
                            *height_mm,
                        ));
                    }
                }
            }
        }
        table.push_str("</w:p></w:tc>");
    }
    table.push_str("</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"1\" w:lineRule=\"exact\"/></w:pPr></w:p>");
    let root = if kind == "header" { "hdr" } else { "ftr" };
    let namespaces = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture""#;
    parts.insert(
        format!("word/infinite-{kind}.xml"),
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:{root} {namespaces}>{table}</w:{root}>"
        )
        .into_bytes(),
    );
    parts.insert(format!("word/_rels/infinite-{kind}.xml.rels"), format!("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{relationships}</Relationships>").into_bytes());
    if region.hide_first_page {
        parts.insert(
            format!("word/infinite-{kind}-first.xml"),
            format!("<w:{root} {namespaces}><w:p/></w:{root}>").into_bytes(),
        );
    }
    Ok(())
}

fn apply_docx(parts: &mut Parts, layout: &LayoutDocument, page_count: usize) -> Result<(), String> {
    let width = layout
        .paper
        .resolved_width_mm()
        .ok_or("Office 导出需要固定纸张")?;
    let height = layout
        .paper
        .resolved_height_mm()
        .ok_or("Office 导出需要固定纸张")?;
    let margins = &layout.margins;
    let mut body = xml(parts, "word/document.xml")?;
    let mut relationships = xml(parts, "word/_rels/document.xml.rels")?;
    let mut content_types = xml(parts, "[Content_Types].xml")?;
    let mut section = String::new();
    let has_first = [&layout.page_furniture.header, &layout.page_furniture.footer]
        .iter()
        .any(|region| region.enabled && region.hide_first_page);
    for (kind, region) in [
        ("header", &layout.page_furniture.header),
        ("footer", &layout.page_furniture.footer),
    ] {
        if !region.enabled {
            continue;
        }
        docx_region(parts, layout, kind, region, page_count)?;
        let id = format!("Infinite{kind}");
        insert(&mut relationships, "</Relationships>", &format!("<Relationship Id=\"{id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}\" Target=\"infinite-{kind}.xml\"/>"))?;
        insert(&mut content_types, "</Types>", &format!("<Override PartName=\"/word/infinite-{kind}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml\"/>"))?;
        section.push_str(&format!(
            "<w:{kind}Reference w:type=\"default\" r:id=\"{id}\"/>"
        ));
        if has_first {
            let first_id = if region.hide_first_page {
                insert(&mut relationships, "</Relationships>", &format!("<Relationship Id=\"{id}First\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}\" Target=\"infinite-{kind}-first.xml\"/>"))?;
                insert(&mut content_types, "</Types>", &format!("<Override PartName=\"/word/infinite-{kind}-first.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml\"/>"))?;
                format!("{id}First")
            } else {
                id
            };
            section.push_str(&format!(
                "<w:{kind}Reference w:type=\"first\" r:id=\"{first_id}\"/>"
            ));
        }
    }
    for (extension, mime) in [
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
    ] {
        if !content_types.contains(&format!("Extension=\"{extension}\"")) {
            insert(
                &mut content_types,
                "</Types>",
                &format!("<Default Extension=\"{extension}\" ContentType=\"{mime}\"/>"),
            )?;
        }
    }
    section.push_str(&format!(r#"<w:pgSz w:w="{}" w:h="{}"{}/><w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="{}" w:footer="{}" w:gutter="0"/>{}"#,
        twips(width),twips(height), if width > height { " w:orient=\"landscape\"" } else { "" }, twips(margins.top_mm),twips(margins.right_mm),twips(margins.bottom_mm),twips(margins.left_mm), twips(layout.page_furniture.header.style.margin_top_mm),twips(layout.page_furniture.footer.style.margin_bottom_mm), if has_first { "<w:titlePg/>" } else { "" }));
    replace(
        &mut body,
        "w:sectPr",
        &format!("<w:sectPr>{section}</w:sectPr>"),
    )?;
    parts.insert("word/document.xml".into(), body.into_bytes());
    parts.insert(
        "word/_rels/document.xml.rels".into(),
        relationships.into_bytes(),
    );
    parts.insert("[Content_Types].xml".into(), content_types.into_bytes());
    let mut styles = xml(parts, "word/styles.xml")?;
    let family = escape(&font(&layout.typography.body_font));
    let size = (layout.typography.body_font_size_pt * 2.0).round() as i32;
    replace(
        &mut styles,
        "w:docDefaults",
        &format!(
            r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{family}" w:hAnsi="{family}" w:eastAsia="{family}" w:cs="{family}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="{}" w:line="{}" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>"#,
            (layout.typography.paragraph_spacing_pt * 20.0).round() as i32,
            (layout.typography.body_font_size_pt * layout.typography.line_height * 20.0).round()
                as i32
        ),
    )?;
    // Pandoc's BodyText has extra spacing; override styles actually used by it.
    for name in ["BodyText", "FirstParagraph", "Compact"] {
        replace_style(
            &mut styles,
            name,
            &format!(
                r#"<w:style w:type="paragraph" w:styleId="{name}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="{}" w:line="{}" w:lineRule="exact"/><w:widowControl w:val="0"/></w:pPr></w:style>"#,
                (layout.typography.paragraph_spacing_pt * 20.0).round() as i32,
                (layout.typography.body_font_size_pt * layout.typography.line_height * 20.0).round()
                    as i32
            ),
        )?;
    }
    for (index, px, before, after) in [
        (1, 28.0, 0.0, 18.0),
        (2, 20.0, 18.0, 10.0),
        (3, 18.0, 16.0, 9.0),
        (4, 16.0, 14.0, 8.0),
        (5, 14.0, 12.0, 7.0),
        (6, 13.0, 10.0, 6.0),
    ] {
        let name = format!("Heading{index}");
        replace_style(
            &mut styles,
            &name,
            &format!(
                r#"<w:style w:type="paragraph" w:styleId="{name}"><w:name w:val="heading {index}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="{}" w:after="{}" w:line="{}" w:lineRule="exact"/><w:outlineLvl w:val="{}"/><w:widowControl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
                (before * 15.0) as i32,
                (after * 15.0) as i32,
                (px * 15.0 * layout.typography.line_height).round() as i32,
                index - 1,
                (px * 1.5) as i32
            ),
        )?;
    }
    for alignment in ["left", "center", "right", "justify"] {
        let name = format!("InfiniteAlign{alignment}");
        replace_style(&mut styles,&name,&format!("<w:style w:type=\"paragraph\" w:styleId=\"{name}\"><w:name w:val=\"{name}\"/><w:basedOn w:val=\"BodyText\"/><w:pPr><w:jc w:val=\"{}\"/></w:pPr></w:style>",if alignment=="justify" {"both"} else {alignment}))?;
    }
    parts.insert("word/styles.xml".into(), styles.into_bytes());
    if parts.contains_key("word/settings.xml") {
        let mut settings = xml(parts, "word/settings.xml")?;
        if span(&settings, "w:updateFields")?.is_some() {
            replace(
                &mut settings,
                "w:updateFields",
                "<w:updateFields w:val=\"true\"/>",
            )?;
        } else {
            insert(
                &mut settings,
                "</w:settings>",
                "<w:updateFields w:val=\"true\"/>",
            )?;
        }
        parts.insert("word/settings.xml".into(), settings.into_bytes());
    }
    Ok(())
}

fn replace_style(styles: &mut String, id: &str, replacement: &str) -> Result<(), String> {
    let marker = format!("w:styleId=\"{id}\"");
    if let Some(index) = styles.find(&marker) {
        let start = styles[..index]
            .rfind("<w:style ")
            .ok_or("Office 段落样式无效")?;
        let (_, end) = span(&styles[start..], "w:style")?.ok_or("Office 段落样式无效")?;
        styles.replace_range(start..start + end, replacement);
    } else {
        insert(styles, "</w:styles>", replacement)?;
    }
    Ok(())
}

fn odt_region(
    parts: &mut Parts,
    layout: &LayoutDocument,
    kind: &str,
    region: &PageRegion,
    page_count: usize,
    definitions: &mut String,
    manifest: &mut String,
) -> Result<String, String> {
    let style = &region.style;
    let left = style.margin_left_mm.unwrap_or(layout.margins.left_mm);
    let right = style.margin_right_mm.unwrap_or(layout.margins.right_mm);
    let width = layout
        .paper
        .resolved_width_mm()
        .ok_or("Office 导出需要固定纸张")?
        - left
        - right;
    let cell =
        (width - style.padding_left_mm - style.padding_right_mm - 2.0 * style.column_gap_mm) / 3.0;
    let height = if kind.starts_with("header") {
        layout.margins.top_mm
    } else {
        layout.margins.bottom_mm
    } - style.margin_top_mm
        - style.margin_bottom_mm;
    let prefix = format!("Infinite{kind}");
    let border = if style.separator {
        format!(
            "fo:border-{}=\"0.5pt solid {}\"",
            if kind.starts_with("header") {
                "bottom"
            } else {
                "top"
            },
            style.color
        )
    } else {
        String::new()
    };
    definitions.push_str(&format!(r#"<style:style style:name="{prefix}Table" style:family="table"><style:table-properties style:width="{width:.4}mm" table:align="margins" fo:margin-left="{:.4}mm" fo:margin-right="{:.4}mm"/></style:style><style:style style:name="{prefix}Row" style:family="table-row"><style:table-row-properties style:min-row-height="{height:.4}mm"/></style:style><style:style style:name="{prefix}Cell" style:family="table-cell"><style:table-cell-properties style:vertical-align="{}" fo:padding-top="{:.4}mm" fo:padding-bottom="{:.4}mm" fo:padding-left="0mm" fo:padding-right="0mm" {border}/></style:style>"#, left-layout.margins.left_mm, right-layout.margins.right_mm, if kind.starts_with("header") { "bottom" } else { "top" }, style.padding_top_mm, style.padding_bottom_mm));
    let widths = [
        cell + style.padding_left_mm,
        style.column_gap_mm,
        cell,
        style.column_gap_mm,
        cell + style.padding_right_mm,
    ];
    let mut result =
        format!("<table:table table:name=\"{prefix}\" table:style-name=\"{prefix}Table\">");
    for (index, width) in widths.into_iter().enumerate() {
        definitions.push_str(&format!("<style:style style:name=\"{prefix}Column{index}\" style:family=\"table-column\"><style:table-column-properties style:column-width=\"{width:.4}mm\"/></style:style>"));
        result.push_str(&format!(
            "<table:table-column table:style-name=\"{prefix}Column{index}\"/>"
        ));
    }
    result.push_str(&format!(
        "<table:table-row table:style-name=\"{prefix}Row\">"
    ));
    let mut image_id = 0;
    for (index, fields) in [
        Some(&region.left),
        None,
        Some(&region.center),
        None,
        Some(&region.right),
    ]
    .into_iter()
    .enumerate()
    {
        let alignment = ["left", "left", "center", "left", "right"][index];
        definitions.push_str(&format!(r#"<style:style style:name="{prefix}Paragraph{index}" style:family="paragraph"><style:paragraph-properties fo:text-align="{alignment}" fo:margin-top="0pt" fo:margin-bottom="0pt" fo:margin-left="{:.4}mm" fo:margin-right="{:.4}mm" fo:line-height="{:.4}pt"/><style:text-properties style:font-name="Infinite{kind}Font" style:font-name-asian="Infinite{kind}Font" fo:font-size="{:.4}pt" style:font-size-asian="{:.4}pt" fo:color="{}"/></style:style>"#, if index==0 {style.padding_left_mm}else{0.0}, if index==4 {style.padding_right_mm}else{0.0}, style.font_size_pt*1.3, style.font_size_pt, style.font_size_pt, style.color));
        result.push_str(&format!("<table:table-cell table:style-name=\"{prefix}Cell\"><text:p text:style-name=\"{prefix}Paragraph{index}\">"));
        if let Some(fields) = fields {
            for (field_index, field) in fields.iter().enumerate() {
                if let PageField::Image {
                    src,
                    alt,
                    width_mm,
                    height_mm,
                } = field
                {
                    image_id += 1;
                    let (extension, bytes) = decode_image(src)?;
                    let path = format!("Pictures/infinite-{kind}-{image_id}.{extension}");
                    parts.insert(path.clone(), bytes);
                    manifest.push_str(&format!("<manifest:file-entry manifest:full-path=\"{path}\" manifest:media-type=\"image/{}\"/>", if extension=="jpg" {"jpeg"} else {extension}));
                    result.push_str(&format!("<draw:frame draw:name=\"{prefix}Image{image_id}\" text:anchor-type=\"as-char\" svg:width=\"{width_mm:.4}mm\" svg:height=\"{height_mm:.4}mm\"><draw:image xlink:href=\"{path}\" xlink:type=\"simple\" xlink:show=\"embed\" xlink:actuate=\"onLoad\"/><svg:title>{}</svg:title></draw:frame>",escape(alt)));
                    continue;
                }
                let name = format!("{prefix}Run{index}_{field_index}");
                let mut attrs = String::new();
                for mark in marks(field, region) {
                    attrs.push_str(match mark {
                    PageTextMark::Bold => " fo:font-weight=\"bold\" style:font-weight-asian=\"bold\"",
                    PageTextMark::Italic => " fo:font-style=\"italic\" style:font-style-asian=\"italic\"",
                    PageTextMark::Underline => " style:text-underline-style=\"solid\" style:text-underline-type=\"single\"",
                    PageTextMark::Strikethrough => " style:text-line-through-style=\"solid\" style:text-line-through-type=\"single\"",
                });
                }
                definitions.push_str(&format!("<style:style style:name=\"{name}\" style:family=\"text\"><style:text-properties{attrs}/></style:style>"));
                let text = match field {
                    PageField::Text { value, .. } => escape(value),
                    PageField::Page { .. } => {
                        "<text:page-number text:select-page=\"current\">1</text:page-number>".into()
                    }
                    PageField::Pages { .. } => {
                        format!("<text:page-count>{page_count}</text:page-count>")
                    }
                    _ => unreachable!(),
                };
                result.push_str(&format!(
                    "<text:span text:style-name=\"{name}\">{text}</text:span>"
                ));
            }
        }
        result.push_str("</text:p></table:table-cell>");
    }
    result.push_str("</table:table-row></table:table>");
    Ok(result)
}

fn replace_odt_style(styles: &mut String, id: &str, replacement: &str) -> Result<(), String> {
    let marker = format!("style:name=\"{id}\"");
    if let Some(index) = styles.find(&marker) {
        let start = styles[..index]
            .rfind("<style:style ")
            .ok_or("ODT 段落样式无效")?;
        let (_, end) = span(&styles[start..], "style:style")?.ok_or("ODT 段落样式无效")?;
        styles.replace_range(start..start + end, replacement);
    } else {
        insert(styles, "</office:styles>", replacement)?;
    }
    Ok(())
}

fn apply_odt(parts: &mut Parts, layout: &LayoutDocument, page_count: usize) -> Result<(), String> {
    let width = layout
        .paper
        .resolved_width_mm()
        .ok_or("Office 导出需要固定纸张")?;
    let height = layout
        .paper
        .resolved_height_mm()
        .ok_or("Office 导出需要固定纸张")?;
    let mut styles = xml(parts, "styles.xml")?;
    let mut manifest = xml(parts, "META-INF/manifest.xml")?;
    let mut definitions = String::new();
    let mut manifest_entries = String::new();
    let mut master = String::new();
    let margins = &layout.margins;
    let mut top = margins.top_mm;
    let mut bottom = margins.bottom_mm;
    let mut region_styles = String::new();
    let has_first = [&layout.page_furniture.header, &layout.page_furniture.footer]
        .iter()
        .any(|region| region.enabled && region.hide_first_page);
    for (kind, region) in [
        ("header", &layout.page_furniture.header),
        ("footer", &layout.page_furniture.footer),
    ] {
        insert(
            &mut styles,
            "</office:font-face-decls>",
            &format!(
                "<style:font-face style:name=\"Infinite{kind}Font\" svg:font-family=\"{}\"/>",
                escape(&font(&region.style.font_family))
            ),
        )?;
        if !region.enabled {
            continue;
        }
        let region_html = odt_region(
            parts,
            layout,
            kind,
            region,
            page_count,
            &mut definitions,
            &mut manifest_entries,
        )?;
        master.push_str(&format!("<style:{kind}>{region_html}</style:{kind}>"));
        if has_first {
            // Keep the same occupied area on the first page, but omit content.
            let mut empty = region.clone();
            if region.hide_first_page {
                empty.left.clear();
                empty.center.clear();
                empty.right.clear();
                empty.style.separator = false;
            }
            let empty_kind = format!("{kind}First");
            insert(&mut styles,"</office:font-face-decls>",&format!("<style:font-face style:name=\"Infinite{empty_kind}Font\" svg:font-family=\"{}\"/>",escape(&font(&region.style.font_family))))?;
            let empty_html = odt_region(
                parts,
                layout,
                &empty_kind,
                &empty,
                page_count,
                &mut definitions,
                &mut manifest_entries,
            )?;
            master.push_str(&format!(
                "<style:{kind}-first>{empty_html}</style:{kind}-first>"
            ));
        }
        let (outer, inner, area) = if kind == "header" {
            top = region.style.margin_top_mm;
            (
                region.style.margin_top_mm,
                region.style.margin_bottom_mm,
                margins.top_mm,
            )
        } else {
            bottom = region.style.margin_bottom_mm;
            (
                region.style.margin_bottom_mm,
                region.style.margin_top_mm,
                margins.bottom_mm,
            )
        };
        region_styles.push_str(&format!("<style:{kind}-style><style:header-footer-properties fo:min-height=\"{:.4}mm\" fo:margin-{}=\"{inner:.4}mm\" style:dynamic-spacing=\"false\"/></style:{kind}-style>",area-outer-inner, if kind=="header" {"bottom"}else{"top"}));
    }
    replace(
        &mut styles,
        "style:page-layout",
        &format!(
            r#"<style:page-layout style:name="Mpm1"><style:page-layout-properties fo:page-width="{width:.4}mm" fo:page-height="{height:.4}mm" fo:margin-top="{top:.4}mm" fo:margin-bottom="{bottom:.4}mm" fo:margin-left="{:.4}mm" fo:margin-right="{:.4}mm" style:print-orientation="{}"/>{region_styles}</style:page-layout>"#,
            margins.left_mm,
            margins.right_mm,
            if width > height {
                "landscape"
            } else {
                "portrait"
            }
        ),
    )?;
    replace(&mut styles,"office:master-styles",&format!("<office:master-styles><style:master-page style:name=\"Standard\" style:page-layout-name=\"Mpm1\">{master}</style:master-page></office:master-styles>"))?;
    let family = escape(&font(&layout.typography.body_font));
    insert(
        &mut styles,
        "</office:font-face-decls>",
        &format!("<style:font-face style:name=\"InfiniteBodyFont\" svg:font-family=\"{family}\"/>"),
    )?;
    let typography = &layout.typography;
    let props = format!(
        r#"<style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="{:.4}pt" fo:line-height="{:.4}pt" fo:orphans="1" fo:widows="1"/><style:text-properties style:font-name="InfiniteBodyFont" style:font-name-asian="InfiniteBodyFont" style:font-name-complex="InfiniteBodyFont" fo:font-size="{:.4}pt" style:font-size-asian="{:.4}pt" style:font-size-complex="{:.4}pt"/>"#,
        typography.paragraph_spacing_pt,
        typography.body_font_size_pt * typography.line_height,
        typography.body_font_size_pt,
        typography.body_font_size_pt,
        typography.body_font_size_pt
    );
    for name in ["Standard", "Text_20_body", "First_20_paragraph", "Compact"] {
        replace_odt_style(&mut styles,name,&format!("<style:style style:name=\"{name}\" style:family=\"paragraph\"{}>{props}</style:style>",if name=="Standard" {""}else{" style:parent-style-name=\"Standard\""}))?;
    }
    for (index, px, before, after) in [
        (1, 28.0, 0.0, 18.0),
        (2, 20.0, 18.0, 10.0),
        (3, 18.0, 16.0, 9.0),
        (4, 16.0, 14.0, 8.0),
        (5, 14.0, 12.0, 7.0),
        (6, 13.0, 10.0, 6.0),
    ] {
        let name = format!("Heading_20_{index}");
        replace_odt_style(
            &mut styles,
            &name,
            &format!(
                r#"<style:style style:name="{name}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="{:.4}pt" fo:margin-bottom="{:.4}pt" fo:line-height="{:.4}pt"/><style:text-properties fo:font-size="{:.4}pt" style:font-size-asian="{:.4}pt" fo:font-weight="bold" style:font-weight-asian="bold"/></style:style>"#,
                before * 0.75,
                after * 0.75,
                px * 0.75 * typography.line_height,
                px * 0.75,
                px * 0.75
            ),
        )?;
    }
    for alignment in ["left", "center", "right", "justify"] {
        let name = format!("InfiniteAlign{alignment}");
        replace_odt_style(&mut styles,&name,&format!("<style:style style:name=\"{name}\" style:family=\"paragraph\" style:parent-style-name=\"Text_20_body\"><style:paragraph-properties fo:text-align=\"{alignment}\"/></style:style>"))?;
    }
    insert(&mut styles,"</office:styles>","<style:style style:name=\"InfinitePageBreak\" style:family=\"paragraph\"><style:paragraph-properties fo:break-before=\"page\" fo:margin-top=\"0pt\" fo:margin-bottom=\"0pt\" fo:line-height=\"0.01pt\"/><style:text-properties fo:font-size=\"0.01pt\"/></style:style>")?;
    insert(&mut styles, "</office:automatic-styles>", &definitions)?;
    insert(&mut manifest, "</manifest:manifest>", &manifest_entries)?;
    parts.insert("styles.xml".into(), styles.into_bytes());
    parts.insert("META-INF/manifest.xml".into(), manifest.into_bytes());
    Ok(())
}
