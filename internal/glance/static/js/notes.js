import { elem, fragment } from "./templating.js";
import { animateReposition } from "./animations.js";
import { clamp, Vec2, toggleableEvents, throttledDebounce } from "./utils.js";

export default function (element) {
	element.swapWith(Notes(element.dataset.notesId));
}

function itemAnim(height, entrance = true) {
	const visible = { height: height + "px", opacity: 1 };
	const hidden = { height: "0", opacity: 0, padding: "0" };

	return {
		keyframes: [entrance ? hidden : visible, entrance ? visible : hidden],
		options: { duration: 200, easing: "ease" },
	};
}

function inputMarginAnim(entrance = true) {
	const amount = "1.5rem";

	return {
		keyframes: [
			{ marginBottom: entrance ? "0px" : amount },
			{ marginBottom: entrance ? amount : "0" },
		],
		options: { duration: 200, easing: "ease", fill: "forwards" },
	};
}

function loadFromLocalStorage(id) {
	return JSON.parse(localStorage.getItem(`notes-${id}`) || "[]");
}

function saveToLocalStorage(id, data) {
	localStorage.setItem(`notes-${id}`, JSON.stringify(data));
}

function renderMarkdown(text) {
	if (!text) return "";

	text = text.trim();

	const codeBlocks = [];
	let codeBlockIndex = 0;

	text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
		const placeholder = `§§§GLANCECODE${codeBlockIndex}§§§`;
		codeBlocks.push(code.trim());
		codeBlockIndex++;
		return placeholder;
	});

	let html = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/^### (.*$)/gim, "<h3>$1</h3>")
		.replace(/^## (.*$)/gim, "<h2>$1</h2>")
		.replace(/^# (.*$)/gim, "<h1>$1</h1>")
		.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>")
		.replace(/__(.+?)__/g, "<strong>$1</strong>")
		.replace(/_(.+?)_/g, "<em>$1</em>")
		.replace(
			/\[(.+?)\]\((.+?)\)/g,
			'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
		)
		.replace(/`(.+?)`/g, "<code>$1</code>");

	const lines = html.split("\n");
	const processed = [];
	let inUl = false;
	let inOl = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const ulMatch = line.match(/^- (.+)$/);
		const olMatch = line.match(/^\d+\. (.+)$/);

		if (ulMatch) {
			if (inOl) {
				processed.push("</ol>");
				inOl = false;
			}
			if (!inUl) {
				processed.push("<ul>");
				inUl = true;
			}
			processed.push(`<li>${ulMatch[1]}</li>`);
		} else if (olMatch) {
			if (inUl) {
				processed.push("</ul>");
				inUl = false;
			}
			if (!inOl) {
				processed.push("<ol>");
				inOl = true;
			}
			processed.push(`<li>${olMatch[1]}</li>`);
		} else {
			if (inUl) {
				processed.push("</ul>");
				inUl = false;
			}
			if (inOl) {
				processed.push("</ol>");
				inOl = false;
			}
			processed.push(line);
		}
	}

	if (inUl) processed.push("</ul>");
	if (inOl) processed.push("</ol>");

	html = processed
		.join("\n")
		.replace(/\n\n/g, "</p><p>")
		.replace(/\n/g, "<br>");

	codeBlocks.forEach((code, index) => {
		const escapedCode = code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		html = html.replace(`§§§GLANCECODE${index}§§§`, `<pre><code>${escapedCode}</code></pre>`);
	});

	return `<p>${html}</p>`
		.replace(/<p><\/p>/g, "")
		.replace(/<p>(<[houp])/g, "$1")
		.replace(/(<\/[houp][^>]*>)<\/p>/g, "$1")
		.replace(/(<[uo]l>)<br>/g, "$1")
		.replace(/<br>(<\/[uo]l>)/g, "$1")
		.replace(/<\/li><br><li>/g, "</li><li>")
		.replace(/(<pre>)<br>/g, "$1")
		.replace(/<br>(<\/pre>)/g, "$1");
}

function autoScalingTextarea(yieldTextarea = null) {
	let textarea, mimic;

	const updateMimic = (newValue) => mimic.text(newValue + " ");
	const container = elem()
		.classes("auto-scaling-textarea-container")
		.append(
			(textarea = elem("textarea")
				.classes("auto-scaling-textarea")
				.on("input", () => updateMimic(textarea.value))),
			(mimic = elem().classes("auto-scaling-textarea-mimic")),
		);

	if (typeof yieldTextarea === "function") yieldTextarea(textarea);

	return container.component({
		setValue: (newValue) => {
			textarea.value = newValue;
			updateMimic(newValue);
		},
	});
}

function Note(unserialize = {}, onUpdate, onDelete, onEscape, onDragStart) {
	let noteItem, contentInput, contentArea, preview;

	const serializeable = {
		content: unserialize.content || "",
	};

	const updatePreview = () => {
		const contentHtml = renderMarkdown(serializeable.content);
		preview.html(
			contentHtml || '<p class="note-empty-placeholder">Empty note</p>',
		);
	};

	const enterEditMode = () => {
		noteItem
			.classes("note-item-mode-edit")
			.clearClasses("note-item-mode-view");
		contentArea.focus();
	};

	const exitEditMode = () => {
		noteItem
			.classes("note-item-mode-view")
			.clearClasses("note-item-mode-edit");
		updatePreview();
	};

	const showContextMenu = (e, item) => {
		const existingMenu = document.querySelector(".note-context-menu");
		if (existingMenu) existingMenu.remove();

		const menu = elem()
			.classes("note-context-menu")
			.styles({
				position: "fixed",
				left: e.clientX + "px",
				top: e.clientY + "px",
			})
			.append(
				elem("button")
					.classes("note-context-menu-item")
					.text("Edit note")
					.on("click", () => {
						menu.remove();
						enterEditMode();
					}),
				elem("button")
					.classes(
						"note-context-menu-item",
						"note-context-menu-item-danger",
					)
					.text("Delete note")
					.on("click", () => {
						menu.remove();
						onDelete(item);
					}),
			);

		document.body.appendChild(menu);

		const closeMenu = () => {
			menu.remove();
			document.removeEventListener("click", closeMenu);
			document.removeEventListener("contextmenu", closeMenu);
		};

		setTimeout(() => {
			document.addEventListener("click", closeMenu);
			document.addEventListener("contextmenu", closeMenu);
		}, 0);
	};

	noteItem = elem()
		.classes("note-item", "note-item-mode-view")
		.append(
			elem()
				.classes("note-item-drag-handle")
				.on("mousedown", (e) => onDragStart(e, noteItem)),

			elem()
				.classes("note-item-body")
				.append(
					(contentInput = autoScalingTextarea(
						(textarea) =>
							(contentArea = textarea
								.classes("note-item-content")
								.attrs({
									placeholder:
										"Write your note in markdown...",
									spellcheck: "true",
								})
								.on("keydown", (e) => {
									if (e.key === "Escape") {
										e.preventDefault();
										exitEditMode();
										onEscape();
									}
								})
								.on("input", () => {
									serializeable.content = contentArea.value.trim();
									onUpdate();
								})
								.on("blur", () => {
									setTimeout(() => exitEditMode(), 100);
								})),
					).classes("note-item-edit")),
					(preview = elem()
						.classes("note-item-preview")
						.on("click", enterEditMode)),
				),
		)
		.on("contextmenu", (e) => {
			e.preventDefault();
			showContextMenu(e, noteItem);
		});

	contentInput.component.setValue(serializeable.content);
	updatePreview();

	return noteItem.component({
		focusInput: () => contentArea.focus(),
		serialize: () => serializeable,
	});
}

function Notes(id) {
	let items, input, inputArea, inputContainer, lastAddedNote;
	let queuedForRemoval = 0;
	let reorderable;
	let isDragging = false;

	const onDragEnd = () => (isDragging = false);
	const onDragStart = (event, element) => {
		isDragging = true;
		reorderable.component.onDragStart(event, element);
	};

	const saveItems = () => {
		if (isDragging) return;

		saveToLocalStorage(
			id,
			items.children.map((item) => item.component.serialize()),
		);
	};

	const onItemRepositioned = () => saveItems();
	const debouncedOnItemUpdate = throttledDebounce(saveItems, 10, 1000);

	const onItemDelete = (item) => {
		if (lastAddedNote === item) lastAddedNote = null;
		const height = item.clientHeight;
		queuedForRemoval++;
		item.animate(itemAnim(height, false), () => {
			item.remove();
			queuedForRemoval--;
			saveItems();
		});

		if (items.children.length - queuedForRemoval === 0)
			inputContainer.animate(inputMarginAnim(false));
	};

	const newNote = (data) =>
		Note(
			data,
			debouncedOnItemUpdate,
			onItemDelete,
			() => inputArea.focus(),
			onDragStart,
		);

	const addNewNote = (noteContent, prepend) => {
		const totalItemsBeforeAppending = items.children.length;
		const note = (lastAddedNote = newNote({ content: noteContent }));

		prepend ? items.prepend(note) : items.append(note);
		saveItems();
		const height = note.clientHeight;
		note.animate(itemAnim(height));

		if (totalItemsBeforeAppending === 0)
			inputContainer.animate(inputMarginAnim());
	};

	const handleInputKeyDown = (e) => {
		switch (e.key) {
			case "Enter":
				if (e.metaKey || e.ctrlKey || e.shiftKey) {
					e.preventDefault();
					const textarea = e.target;
					const start = textarea.selectionStart;
					const end = textarea.selectionEnd;
					const value = textarea.value;
					textarea.value = value.substring(0, start) + "\n" + value.substring(end);
					textarea.selectionStart = textarea.selectionEnd = start + 1;
					textarea.dispatchEvent(new Event('input', { bubbles: true }));
					return;
				}
				e.preventDefault();
				const value = e.target.value.trim();
				if (value === "") return;
				addNewNote(value, false);
				input.component.setValue("");
				break;
			case "Escape":
				e.target.blur();
				break;
			case "ArrowDown":
				if (!lastAddedNote) return;
				e.preventDefault();
				lastAddedNote.component.focusInput();
				break;
		}
	};

	items = elem()
		.classes("notes-items")
		.append(...loadFromLocalStorage(id).map((data) => newNote(data)));

	return fragment().append(
		(inputContainer = elem()
			.classes("notes-input", "flex", "gap-10", "items-center")
			.classesIf(items.children.length > 0, "margin-bottom-15")
			.styles({ paddingRight: "2.5rem" })
			.append(
				elem().classes("notes-plus-icon", "shrink-0"),
				(input = autoScalingTextarea(
					(textarea) =>
						(inputArea = textarea
							.on("keydown", handleInputKeyDown)
							.attrs({
								placeholder: "Add a note",
								spellcheck: "false",
							})),
				).classes("grow", "min-width-0")),
			)),
		(reorderable = verticallyReorderable(
			items,
			onItemRepositioned,
			onDragEnd,
		)),
	);
}

function verticallyReorderable(itemsContainer, onItemRepositioned, onDragEnd) {
	const classToAddToDraggedItem = "is-being-dragged";

	const currentlyBeingDragged = {
		element: null,
		initialIndex: null,
		clientOffset: Vec2.new(),
	};

	const decoy = {
		element: null,
		currentIndex: null,
	};

	const draggableContainer = {
		element: null,
		initialRect: null,
	};

	const lastClientPos = Vec2.new();
	let initialScrollY = null;
	let addDocumentEvents, removeDocumentEvents;

	const handleReposition = (event) => {
		if (currentlyBeingDragged.element == null) return;

		if (event.clientY !== undefined && event.clientX !== undefined)
			lastClientPos.setFromEvent(event);

		const client = lastClientPos;
		const container = draggableContainer;
		const item = currentlyBeingDragged;

		const scrollOffset = window.scrollY - initialScrollY;
		const offsetY =
			client.y -
			container.initialRect.y -
			item.clientOffset.y +
			scrollOffset;
		const offsetX =
			client.x - container.initialRect.x - item.clientOffset.x;

		const scrollbarWidth =
			window.innerWidth - document.documentElement.clientWidth;
		const viewportWidth = window.innerWidth - scrollbarWidth;

		const confinedX = clamp(
			offsetX,
			-container.initialRect.x,
			viewportWidth -
				container.initialRect.x -
				container.initialRect.width,
		);

		container.element.styles({
			transform: `translate(${confinedX}px, ${offsetY}px)`,
		});

		const containerTop = client.y - item.clientOffset.y;
		const containerBottom =
			client.y + container.initialRect.height - item.clientOffset.y;

		let swapWithLast = true;
		let swapWithIndex = null;

		for (let i = 0; i < itemsContainer.children.length; i++) {
			const childRect =
				itemsContainer.children[i].getBoundingClientRect();
			const topThreshold = childRect.top + childRect.height * 0.6;
			const bottomThreshold = childRect.top + childRect.height * 0.4;

			if (containerBottom > topThreshold) {
				if (containerTop < bottomThreshold && i != decoy.currentIndex) {
					swapWithIndex = i;
					swapWithLast = false;
					break;
				}
				continue;
			}

			swapWithLast = false;

			if (i == decoy.currentIndex || i - 1 == decoy.currentIndex) break;
			swapWithIndex = i < decoy.currentIndex ? i : i - 1;
			break;
		}

		const lastItemIndex = itemsContainer.children.length - 1;

		if (swapWithLast && decoy.currentIndex != lastItemIndex)
			swapWithIndex = lastItemIndex;

		if (swapWithIndex === null) return;

		const diff = swapWithIndex - decoy.currentIndex;
		if (Math.abs(diff) > 1) {
			swapWithIndex = decoy.currentIndex + Math.sign(diff);
		}

		const siblingToSwapWith = itemsContainer.children[swapWithIndex];

		if (siblingToSwapWith.isCurrentlyAnimating) return;

		const animateDecoy = animateReposition(decoy.element);
		const animateChild = animateReposition(siblingToSwapWith, () => {
			siblingToSwapWith.isCurrentlyAnimating = false;
			handleReposition({
				clientX: client.x,
				clientY: client.y,
			});
		});

		siblingToSwapWith.isCurrentlyAnimating = true;

		if (swapWithIndex > decoy.currentIndex)
			decoy.element.before(siblingToSwapWith);
		else decoy.element.after(siblingToSwapWith);

		decoy.currentIndex = itemsContainer.children.indexOf(decoy.element);

		animateDecoy();
		animateChild();
	};

	const handleRelease = (event) => {
		if (event.buttons != 0) return;

		removeDocumentEvents();
		const item = currentlyBeingDragged;
		const element = item.element;
		element.styles({ pointerEvents: "none" });
		const animate = animateReposition(element, () => {
			item.element = null;
			element
				.clearClasses(classToAddToDraggedItem)
				.clearStyles("pointer-events");

			if (typeof onDragEnd === "function") onDragEnd(element);

			if (
				item.initialIndex != decoy.currentIndex &&
				typeof onItemRepositioned === "function"
			)
				onItemRepositioned(
					element,
					item.initialIndex,
					decoy.currentIndex,
				);
		});

		decoy.element.swapWith(element);
		draggableContainer.element.append(decoy.element);
		draggableContainer.element.clearStyles("transform", "width");

		item.element = null;
		decoy.element.remove();

		animate();
	};

	const preventDefault = (event) => {
		event.preventDefault();
	};

	const handleGrab = (event, element) => {
		if (currentlyBeingDragged.element != null) return;

		event.preventDefault();

		const item = currentlyBeingDragged;
		if (item.element != null) return;

		addDocumentEvents();
		initialScrollY = window.scrollY;
		const client = lastClientPos.setFromEvent(event);
		const elementRect = element.getBoundingClientRect();

		item.element = element;
		item.initialIndex = decoy.currentIndex =
			itemsContainer.children.indexOf(element);
		item.clientOffset.set(
			client.x - elementRect.x,
			client.y - elementRect.y,
		);

		const elementStyle = getComputedStyle(element);
		const initialWidth = elementStyle.width;

		decoy.element = elem().classes("drag-and-drop-decoy").styles({
			height: elementStyle.height,
			width: initialWidth,
		});

		const container = draggableContainer;

		element.swapWith(decoy.element);
		container.element.append(element);
		element.classes(classToAddToDraggedItem);

		decoy.element.animate({
			keyframes: [{ transform: "scale(.9)", opacity: 0, offset: 0 }],
			options: { duration: 300, easing: "ease" },
		});

		container.element.styles({ width: initialWidth, transform: "none" });
		container.initialRect = container.element.getBoundingClientRect();

		const offsetY = elementRect.y - container.initialRect.y;
		const offsetX = elementRect.x - container.initialRect.x;

		container.element.styles({
			transform: `translate(${offsetX}px, ${offsetY}px)`,
		});
	};

	[addDocumentEvents, removeDocumentEvents] = toggleableEvents(document, {
		mousemove: handleReposition,
		scroll: handleReposition,
		mousedown: preventDefault,
		contextmenu: preventDefault,
		mouseup: handleRelease,
	});

	return elem()
		.classes("drag-and-drop-container")
		.append(
			itemsContainer,
			(draggableContainer.element = elem().classes(
				"drag-and-drop-draggable",
			)),
		)
		.component({
			onDragStart: handleGrab,
		});
}
