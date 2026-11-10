/**
 * The viewer's markup, placed inside the element the viewer is mounted on. Element ids carry a
 * te- prefix so that they cannot collide with the host page's.
 */

export const viewerMarkup = `
<div class="te-layout">
    <section class="controls">
        <div class="start">
            <div class="start-buttons">
                <label class="file">
                    <input type="file" id="te-file" accept="image/*">
                    <span>Choose an image</span>
                </label>
                <button id="te-run" disabled>Extract tree</button>
            </div>
            <label class="ocr"><input type="checkbox" id="te-ocr" checked> Read labels (OCR)</label>
            <div class="start-buttons">
                <button id="te-region-mode" class="tool" disabled title="Drag a rectangle around the tree, to extract only that part of the image">Select region</button>
                <button id="te-clear-region" class="tool" disabled title="Analyze the whole image again">Clear region</button>
            </div>
        </div>
        <label class="names">
            <span>Known taxon names, one per line (optional)</span>
            <textarea id="te-names" rows="4" placeholder="Haya griva&#10;Jeholosaurus shangyuanensis"></textarea>
        </label>
        <p id="te-status" class="status" role="status">No image loaded.</p>
    </section>
    <section class="view">
        <p class="hint">Scroll to zoom and drag to pan. Click a tip, node or label to select it. <em>Add tip</em> then click a branch end; <em>Add node</em> then drag along the missing connector; <em>Move</em> then drag a tip or node onto the node it should hang from. Adding a tip or a node needs a pointer; everything else also works from the keyboard, through the lists and the buttons.</p>
        <div class="toolbar">
            <div class="tool-group" role="group" aria-label="Pointer tool">
                <button id="te-select" class="tool" disabled title="Click to select, drag to pan">Select</button>
                <button id="te-add-tip" class="tool" disabled title="Click where a branch ends to add a tip there">Add tip</button>
                <button id="te-add-node" class="tool" disabled title="Drag along a missing vertical connector to add a node">Add node</button>
                <button id="te-move" class="tool" disabled title="Drag a tip or node onto the node it should hang from">Move</button>
            </div>
            <span class="spacer"></span>
            <div class="tool-row" role="group" aria-label="Edits">
                <button id="te-undo" class="tool" disabled title="Undo the last edit (Ctrl+Z or Cmd+Z)">Undo</button>
                <button id="te-redo" class="tool" disabled title="Redo the last undone edit (Ctrl+Shift+Z or Cmd+Shift+Z)">Redo</button>
                <button id="te-delete" class="tool danger" disabled title="Delete the selected tip or node (Delete key)">Delete</button>
            </div>
        </div>
        <p id="te-mode-hint" class="mode-hint" hidden></p>
        <div id="te-progress" class="progress" role="progressbar" aria-label="Extraction in progress" hidden><div class="bar"></div></div>
        <div class="canvas-wrap" id="te-canvas-wrap">
            <canvas id="te-canvas" tabindex="0" role="img" aria-label="The figure with the traced tree drawn over it; its tips and nodes are listed beside it"></canvas>
            <div class="view-controls" role="group" aria-label="View">
                <button id="te-fit" class="tool" disabled title="Fit the image in the view">Fit</button>
                <button id="te-actual" class="tool" disabled title="Show at one image pixel per screen pixel" aria-label="1:1 (actual size)">1:1</button>
                <button id="te-zoom-out" class="tool" disabled title="Zoom out" aria-label="Zoom out">−</button>
                <button id="te-zoom-in" class="tool" disabled title="Zoom in" aria-label="Zoom in">+</button>
                <span id="te-zoom-level" class="zoom-level"></span>
            </div>
        </div>
        <fieldset class="layers">
            <legend>Show</legend>
            <label><input type="checkbox" data-layer="segments" checked> line art</label>
            <label><input type="checkbox" data-layer="text" checked> text</label>
            <label><input type="checkbox" data-layer="nodes" checked> nodes</label>
            <label><input type="checkbox" data-layer="tips" checked> tips</label>
        </fieldset>
        <div class="box newick">
            <h2>Newick</h2>
            <textarea id="te-newick" rows="5" readonly aria-label="The tree as Newick"></textarea>
            <div class="buttons">
                <button id="te-download-newick" disabled>Download .nwk</button>
                <button id="te-download-nexus" disabled>Download .nex</button>
                <button id="te-download-json" disabled>Download document .json</button>
                <button id="te-download-svg" disabled>Download redrawn .svg</button>
            </div>
        </div>
        <div class="box redraw">
            <h2>Redrawn tree</h2>
            <div id="te-redraw" class="redraw-canvas" tabindex="0" role="img" aria-label="The traced tree redrawn" hidden></div>
        </div>
    </section>
    <section class="results">
        <div id="te-move-row" class="move-row" hidden>
            <label for="te-move-target">Move the selection under</label>
            <select id="te-move-target" disabled></select>
            <button id="te-move-apply" class="tool" disabled>Move it</button>
        </div>
        <p class="hint">Edit a name to correct it; the tree below updates. Click an entry to find it on the figure.</p>
        <div class="box">
            <h2>Tips <span id="te-tips-count" class="count"></span></h2>
            <ol id="te-tips" class="items"></ol>
        </div>
        <div class="box">
            <h2>Nodes <span id="te-nodes-count" class="count"></span></h2>
            <ol id="te-nodes" class="items"></ol>
        </div>
        <div class="box">
            <h2>Quality checks</h2>
            <ul id="te-qc" tabindex="0" aria-label="Quality checks"></ul>
        </div>
        <div class="box">
            <h2>Figure profile</h2>
            <ul id="te-profile" class="profile" tabindex="0" aria-label="Figure profile"></ul>
        </div>
    </section>
    
</div>
`;
