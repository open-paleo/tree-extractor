/**
 * The viewer's markup, placed inside the element the viewer is mounted on. Element ids carry a
 * te- prefix so that they cannot collide with the host page's.
 */

export const viewerMarkup = `
<div class="te-layout">
    <section class="controls">
        <label class="file">
            <input type="file" id="te-file" accept="image/*">
            <span>Choose an image</span>
        </label>
        <label><input type="checkbox" id="te-ocr" checked> Read labels (OCR)</label>
        <label class="names">
            <span>Known taxon names, one per line (optional)</span>
            <textarea id="te-names" rows="4" placeholder="Haya griva&#10;Jeholosaurus shangyuanensis"></textarea>
        </label>
        <button id="te-run" disabled>Extract tree</button>
        <p id="te-status" class="status" role="status">No image loaded.</p>
        <fieldset class="layers">
            <legend>Show</legend>
            <label><input type="checkbox" data-layer="segments" checked> line art</label>
            <label><input type="checkbox" data-layer="text" checked> text</label>
            <label><input type="checkbox" data-layer="nodes" checked> nodes</label>
            <label><input type="checkbox" data-layer="tips" checked> tips</label>
        </fieldset>
        <p class="hint">Scroll to zoom, drag to pan, click a tip, node or label to select it. Use <em>Select region</em> to mark where the tree is when the figure holds more than the tree. <em>Add tip</em> then click a branch end; <em>Add node</em> then drag along the missing connector; <em>Delete</em> removes the selection. Adding a tip or a node needs a pointer; everything else also works from the keyboard, through the lists and the buttons.</p>
    </section>
    <section class="view">
        <div class="toolbar">
            <button id="te-fit" class="tool" disabled title="Fit the image in the view">Fit</button>
            <button id="te-actual" class="tool" disabled title="Show at one image pixel per screen pixel" aria-label="Actual size">1:1</button>
            <button id="te-zoom-in" class="tool" disabled title="Zoom in" aria-label="Zoom in">+</button>
            <button id="te-zoom-out" class="tool" disabled title="Zoom out" aria-label="Zoom out">−</button>
            <span id="te-zoom-level" class="muted"></span>
            <span class="spacer"></span>
            <button id="te-region-mode" class="tool" disabled title="Drag a rectangle around the tree">Select region</button>
            <button id="te-clear-region" class="tool" disabled title="Analyze the whole image again">Clear region</button>
            <span class="divider"></span>
            <button id="te-add-tip" class="tool" disabled title="Click where a branch ends to add a tip there">Add tip</button>
            <button id="te-add-node" class="tool" disabled title="Drag along a missing vertical connector to add a node">Add node</button>
            <button id="te-move" class="tool" disabled title="Drag a tip or node onto the node it should hang from">Move</button>
            <button id="te-undo" class="tool" disabled title="Undo the last edit (Ctrl+Z or Cmd+Z)">Undo</button>
            <button id="te-redo" class="tool" disabled title="Redo the last undone edit (Ctrl+Shift+Z or Cmd+Shift+Z)">Redo</button>
            <button id="te-delete" class="tool danger" disabled title="Delete the selected tip or node (Delete key)">Delete</button>
        </div>
        <p id="te-mode-hint" class="mode-hint" hidden></p>
        <div class="move-row">
            <label for="te-move-target">Move the selection under</label>
            <select id="te-move-target" disabled></select>
            <button id="te-move-apply" class="tool" disabled>Move it</button>
        </div>
        <div id="te-progress" class="progress" role="progressbar" aria-label="Extraction in progress" hidden><div class="bar"></div></div>
        <div class="canvas-wrap" id="te-canvas-wrap"><canvas id="te-canvas" tabindex="0" role="img" aria-label="The figure with the traced tree drawn over it; its tips and nodes are listed beside it"></canvas></div>
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
