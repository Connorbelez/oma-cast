import QtQuick
import qs.Commons

// `preview` is FileActions.parsePreview's result for the selected row, or
// null while it loads.
Rectangle {
  id: pane

  property var preview: null
  property string title: ""
  property string subtitle: ""
  property var look: null
  property real zoom: 1

  signal ready(string kind)

  function px(v) { return Math.round(Style.space(v) * pane.zoom) }

  readonly property string kind: pane.preview ? pane.preview.kind : ""

  function sizeText(bytes) {
    if (!(bytes >= 0)) return ""
    if (bytes < 1024) return bytes + " bytes"
    var units = ["KB", "MB", "GB", "TB"]
    var value = bytes / 1024, unit = 0
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
    return (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) + " " + units[unit]
  }

  readonly property var facts: {
    var p = pane.preview
    var rows = [{ label: "Name", value: pane.title }, { label: "Where", value: pane.subtitle }]
    if (!p) return rows
    var kinds = { text: "Text", image: "Image", pdf: "PDF", meta: "File" }
    rows.push({ label: "Kind", value: kinds[p.kind] || "File" })
    if (p.size >= 0) rows.push({ label: "Size", value: pane.sizeText(p.size) })
    if (p.mtime > 0) rows.push({ label: "Modified", value: new Date(p.mtime * 1000).toLocaleString(Qt.locale(), Locale.ShortFormat).replace(/\s/g, " ") })
    if (p.width > 0) rows.push({ label: "Dimensions", value: p.width + " × " + p.height })
    if (p.lines > 0) rows.push({ label: "Lines", value: p.truncated ? "first " + p.lines : String(p.lines) })
    return rows
  }

  onPreviewChanged: if (pane.preview && pane.preview.kind !== "image") pane.ready(pane.preview.kind)

  color: "transparent"
  clip: true

  Item {
    id: content
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.bottom: divider.top
    anchors.margins: pane.px(12)

    // Under PreserveAspectFit, Qt decodes the image at sourceSize even when
    // that scales it up. Under the default Stretch, sourceSize only scales
    // down and keeps the aspect, so the Image sizes itself to fit.
    Image {
      id: image
      readonly property real fit: implicitWidth > 0 && implicitHeight > 0 ? Math.min(content.width / implicitWidth, content.height / implicitHeight) : 0
      anchors.centerIn: parent
      width: implicitWidth * fit
      height: implicitHeight * fit
      visible: pane.kind === "image"
      asynchronous: true
      cache: false
      sourceSize.width: 1600
      sourceSize.height: 1600
      source: pane.kind === "image" ? pane.preview.imageSource : ""
      onStatusChanged: if (pane.kind === "image" && (status === Image.Ready || status === Image.Error)) pane.ready("image")
    }

    Text {
      id: body
      anchors.fill: parent
      visible: pane.kind === "text" || pane.kind === "pdf"
      textFormat: Text.PlainText
      text: visible ? pane.preview.text : ""
      wrapMode: pane.kind === "pdf" ? Text.Wrap : Text.NoWrap
      elide: Text.ElideRight
      maximumLineCount: Math.max(1, Math.ceil(content.height / Math.max(1, body.font.pixelSize)))
      color: pane.look.foreground
      opacity: 0.85
      font.family: pane.kind === "pdf" ? pane.look.fontFamily : Style.font.family
      font.pixelSize: Math.round(Style.font.caption * pane.zoom)
    }

    Column {
      anchors.centerIn: parent
      spacing: pane.px(6)
      visible: pane.kind === "meta" || (pane.kind === "image" && image.status === Image.Error)

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        textFormat: Text.PlainText
        text: ""
        color: pane.look.foreground
        opacity: 0.35
        font.family: pane.look.fontFamily
        font.pixelSize: pane.px(40)
      }
      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        textFormat: Text.PlainText
        text: pane.kind === "image" ? "Cannot show this image" : "No preview"
        color: pane.look.foreground
        opacity: 0.5
        font.family: pane.look.fontFamily
        font.pixelSize: Math.round(Style.font.bodySmall * pane.zoom)
      }
    }
  }

  Rectangle {
    id: divider
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: factsColumn.top
    anchors.bottomMargin: pane.px(8)
    height: Style.spacing.hairline
    color: Util.alpha(pane.look.foreground, 0.12)
  }

  Column {
    id: factsColumn
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    anchors.leftMargin: pane.px(12)
    anchors.rightMargin: pane.px(12)
    anchors.bottomMargin: pane.px(8)
    spacing: pane.px(3)

    Repeater {
      model: pane.facts

      Item {
        required property var modelData
        width: factsColumn.width
        height: valueText.implicitHeight

        Text {
          textFormat: Text.PlainText
          text: modelData.label
          color: pane.look.foreground
          opacity: 0.5
          font.family: pane.look.fontFamily
          font.pixelSize: Math.round(Style.font.caption * pane.zoom)
        }
        Text {
          id: valueText
          anchors.right: parent.right
          width: Math.min(implicitWidth, parent.width - pane.px(80))
          horizontalAlignment: Text.AlignRight
          textFormat: Text.PlainText
          text: modelData.value
          color: pane.look.foreground
          elide: Text.ElideMiddle
          font.family: pane.look.fontFamily
          font.pixelSize: Math.round(Style.font.caption * pane.zoom)
        }
      }
    }
  }
}
