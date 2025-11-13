package glance

import (
	"html/template"
)

var notesWidgetTemplate = mustParseTemplate("notes.html", "widget-base.html")

type notesWidget struct {
	widgetBase `yaml:",inline"`
	cachedHTML template.HTML `yaml:"-"`
	NotesID    string        `yaml:"id"`
}

func (widget *notesWidget) initialize() error {
	widget.withTitle("Notes").withError(nil)

	widget.cachedHTML = widget.renderTemplate(widget, notesWidgetTemplate)
	return nil
}

func (widget *notesWidget) Render() template.HTML {
	return widget.cachedHTML
}
