/* SpiderOak html5 client Main app. */

/* Copyright 2012 SpiderOak, Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

/*
 * Works with:
 * - jquery.mobile-1.2.0_pre/jquery.mobile.css
 * - jquery.mobile-1.2.0_pre/jquery.mobile.js
 * - jquery-1.7.2.js
 * - cordova-2.0.0.js - PhoneGap API
 * - js_aux/misc.js
 * - js_aux/nibbler.js - Nibbler 2010-04-07 - base32, plus local enhancement
 * - custom-scripting.js - jqm settings and contextual configuration
 */

/*
  NOTES

  - See
    https://github.com/SpiderOak/so_client_html5/wiki/HTML5-Client-Code-Technical-Details
    for technical documentation.  What's below may drift out of date.

  - Content visits:
    We intercept navigation to content (eg, $.mobile.changePage) repository
    URLs and intervene via binding of handle_content_visit to jQuery mobile
    "pagebeforechange" event. URLs included as href links must start with
    '#' to trigger jQuery Mobile's navigation detection, which by default
    tracks changes to location.hash.  handle_content_visit() dispatches those
    URLs it receives that qualify as content and panel nodes.

  - My routines which return jQuery objects end in '$', and - following common
    practice - my variables intended to contain jQuery objects start with '$'.
*/

if (SO_DEBUGGING) {
    console.log("SO_DEBUGGING: " + SO_DEBUGGING); }

/** SpiderOak application object, as a modular singleton. */
var spideroak = function () {
    "use strict";               // ECMAScript 5


    /* == Private elements == */

    /* ==== Object-wide settings ==== */

    /** Constants not specific to a particular login session: */
    var generic = {
        // API v1.
        // XXX base_host_url may vary according to brand package.
        // TODO See about simplifying redundacy of *_url vs *_page_id (and
        //      maybe the .my_page_id methods, etc).
        base_host_url: brand.base_host_url,
        brand_images_dir: "brand_images",
        icons_dir: "icons",
        combo_root_page_id: "home",
        my_shares_root_page_id: "my-shares",
        published_root_page_id: "share",
        recents_page_id: "recents",
        favorites_page_id: "favorites",
        panel_root_page_id: "settings-root",
        storage_root_page_id: "storage-home",
        content_page_template_id: "content-page-template",
        storage_login_path: "/browse/login",
        storage_logout_suffix: "logout",
        storage_path_prefix: "/storage/",
        my_shares_path_suffix: "shares",
        shares_path_suffix: "/share/",
        devices_query_expression: 'device_info=yes',
        versions_query_expression: 'format=version_info',
        home_page_id: 'home',
        root_storage_node_label: "Devices",
        preview_sizes: [25, 48, 228, 800],
        dividers_threshold: 10,
        filter_threshold: 10,
        compact_width_threshold: 400,
        compact_title_chars: 8,
        expansive_title_chars: 25,
        recents_max_size: 25,
        panels_by_url: {},
        public_share_room_urls: {},
        titled_choice_popup_id: 'titled-choice-popup',
        depth_path_popup_id: 'depth-path-popup',
        top_level_info_ids: ['about-dashboard', 'about-spideroak'],
        keychain_servicename: 'Keychain',
    };

    if (SO_DEBUGGING) {
        /* Special Server provisions. */
        var hostname = window.location.hostname;
        if (hostname.slice(hostname.length-14) === ".spideroak.com") {
            generic.debug_proxying = true;
            generic.base_host_url = "https://" + hostname;
            generic.alt_host_replace = "https://web-dc2.spideroak.com";
            generic.alt_host_url = "https://" + hostname;
            generic.storage_path_prefix = "" + generic.storage_path_prefix;
            generic.shares_path_suffix = "" + generic.shares_path_suffix; }

        // XXXXXXXXXXXXX
/*
        generic.base_host_url = "https://devvm";
        generic.alt_host_replace = generic.base_host_url;
        generic.alt_host_url = generic.alt_host_replace;
*/
    }

    /** Login session settings. */
    var my = {
        username: "",
        storage_host: null,
        storage_web_url: null,  // Location of storage web UI for user.
        storage_root_url: null,
        my_shares_root_url: null,
        // All the service's actual shares reside within:
        public_shares_root_url: generic.base_host_url + "/share/",
        original_share_room_urls: {},
    };

    var base32 = new Nibbler({dataBits: 8,
                              codeBits: 5,
                              keyString: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
                              pad: '='});
    Nibbler.prototype.encode_trim = function (str) {
        /* Base32 encoding with trailing "=" removed. */
        return this.encode(str).replace(/=+$/, ''); }


    /* ==== Navigation handlers ==== */

    function handle_content_visit(e, data) {
        /* Intercept URL visits and intervene for repository content. */
        var page = id2url(data.toPage);

        if ((typeof page === "string")
            && (is_node_url(page)
                || method_addresses.hasOwnProperty(page))) {
            e.preventDefault();

            if (SO_DEBUGGING.match(/:content_urls:/)) {
                console.log(page + ": " + data.toPage); }

            if (transit_manager.is_repeat_url(page)) {
                // Popup dismissal sends the URL back through, and the
                // default machinery needs to see it.
                return true; }
            // Extra the modal options from the query string,
            var mode_opts = query_params(page);
            // ... and strip the query string from the page address:
            page = page.split('?')[0];
            if (method_addresses.hasOwnProperty(page)) {
                var internal = id2url(document.location.href);
                return method_addresses[page].call(this, internal); }
            else if (data.toPage !== $.mobile.activePage.attr('id')) {
                node_manager.get_recents().add_visited_url(page);
                // Skip exact duplicates, for eg non-select popup dismissals.
                var node = node_manager.get(page)
                return node.visit(data.options, mode_opts); }
        }
    }

    function establish_traversal_handler() {
        /* Establish page change event handler. */
        bind_replace($(document),
                     "pagebeforechange.SpiderOak",
                     handle_content_visit); }


    /* ==== Content Root Registration ====  */

    /** Register user-specific storage details then visit storage root.
     *
     * @param {string} username the account name
     * @param {string} storage_host the server for the account
     * @param {string} storage_web_url the account's web UI entry address
     */
    function storage_session_embark(username, storage_host, storage_web_url) {
        var storage_url = set_storage_account(username,
                                              storage_host,
                                              storage_web_url);
        if (SO_DEBUGGING.match(/:test_keychain_trivial:/)) {
            test_keychain_trivial('so_username', 'keychain', username); }
        $.mobile.changePage(storage_url);
    }

    /** Register user-specific storage details.
     *
     * We preserve the details using remember_manager
     *
     * @param {string} username the account name
     * @param {string} storage_host the server for the account
     * @param {string} storage_web_url the account's web UI entry address
     */
    function set_storage_account(username, storage_host, storage_web_url) {

        var storage_url = register_storage_root(storage_host, username,
                                                storage_web_url);
        if (! is_root_url(storage_url)) {
            register_content_root_url(storage_url); }

        if (remember_manager.active()) {
            remember_manager.store({username: username,
                                    storage_host: storage_host,
                                    storage_web_url: storage_web_url}); }

        // Return combo root, as determined via register_content_root_url.
        return my.combo_root_url; }

    /** Unregister user-specific storage details.
     *
     * Obliterate internal settings and all content nodes for a clean
     * slate.  All share artifacts, original and other, are removed, as
     * well as registered storage, recents, favorites, settings.  We do not
     * remove persistent settings.
     */
    function clear_storage_account() {
        if (my.my_shares_root_url) {
            var my_shares_root = nmgr.get(my.my_shares_root_url);
            original_share_room_urls_list().map(
                my_shares_root.clear_item)
            // remove_item, above, frees the rooms and contents.
            nmgr.free(my_shares_root); }
        my.my_shares_root_url = "";

        if (my.storage_root_url) {
            node_manager.clear_hierarchy(my.storage_root_url); }
        my.storage_root_url = "";

        node_manager.free(node_manager.get_recents());
        node_manager.free(node_manager.get_favorites());
        node_manager.free(node_manager.get_settings());
        node_manager.free(node_manager.get_combo_root());

        my.username = "";
        my.storage_host = "";
        my.storage_web_url = ""; }


    /* ===== Node-independent content URL categorization ==== */

    // Managed content is organized within two content roots:
    //
    // - the storage root, my.storage_root_url, determined by the user's account
    // - the public share root, which is the same across all accounts
    //
    // There is also a collection of the shares originated by the account,
    // in the OriginalRootShareNode.  Like all share rooms, the items are
    // actually public shares, but the collection listing is only visible
    // from within the account.
    //
    // Content urls are recognized by virtue of beginning with one of the
    // registered content roots. The storage root is registered when the user
    // logs in. The share rooms root is registered upon the registration of
    // any share room.

    function register_storage_root(host, username, storage_web_url) {
        /* Identify user's storage root according to 'host' and 'username'.
           The account's 'storage_web_url' is also conveyed.
           Return the url. */
        my.username = username;
        my.storage_host = host;
        my.storage_web_url = storage_web_url;

        my.storage_root_url = (host
                               + generic.storage_path_prefix
                               + base32.encode_trim(username)
                               + "/");
        // Original root is determined by storage root:
        register_my_shares_root();

        return my.storage_root_url; }

    function register_my_shares_root() {
        /* Identify original share rooms root url. Depends on established
           storage root.  Return the url. */
        my.my_shares_root_url =
            (my.storage_root_url + generic.my_shares_path_suffix); }
    function register_public_share_room_url(url) {
        /* Include url among the registered share rooms.  Returns the url. */
        generic.public_share_room_urls[url] = true;
        return url; }
    function unregister_public_share_room_url(url) {
        /* Remove 'url' from the registered public share rooms.
           Returns the url, or none if nothing to unregister. */
        if (generic.public_share_room_urls.hasOwnProperty(url)) {
            delete generic.public_share_room_urls[url];
            return url; }}
    function register_original_share_room_url(url) {
        /* Include url among the registered original rooms.
           Also registers among the set of all familiar share room urls.
           Returns the url. */
        my.original_share_room_urls[url] = true;
        return url; }
    function unregister_original_share_room_url(url) {
        /* Remove 'url' from the registered original share rooms.
           Returns the url, or none if nothing to unregister. */
        if (my.original_share_room_urls.hasOwnProperty(url)) {
            delete my.original_share_room_urls[url];
            return url; }}
    function is_combo_root_url(url) {
        return (url === my.combo_root_url); }
    function is_recents_url(url) {
        return (url === id2url(generic.recents_page_id)); }
    function is_favorites_url(url) {
        return (url === id2url(generic.favorites_page_id)); }
    function is_panel_root_url(url) {
        return (url === id2url(generic.panel_root_page_id)); }
    function is_root_url(url) {
        /* True if the 'url' is for one of the root content items.  We
           split off any search fragment.  Doesn't depend on the url having
           an established node. */
        url = url.split('?')[0];
        return ((url === my.combo_root_url)
                || (url === id2url(generic.published_root_page_id))
                || (url === id2url(generic.recents_page_id))
                || (url === id2url(generic.favorites_page_id))
                || (url === id2url(generic.panel_root_page_id))
                || (url === my.storage_root_url)
                || (url === my.my_shares_root_url)
                || (url === my.public_shares_root_url)); }
    function is_share_room_url(url) {
        /* True if the 'url' is for one of the familiar share rooms.
           Doesn't depend on the url having an established node. */
        return (is_original_share_room_url(url)
                || is_public_share_room_url(url)); }
    function is_original_share_room_url(url) {
        /* True if the 'url' is for one of the original share rooms.
           Doesn't depend on the url having an established node. */
        return my.original_share_room_urls.hasOwnProperty(url); }
    function is_public_share_room_url(url) {
        /* True if the 'url' is for one of the original share rooms.
           Doesn't depend on the url having an established node. */
        return generic.public_share_room_urls.hasOwnProperty(url); }
    function is_storage_url(url) {
        /* True if the URL is for a content item in the user's storage area.
           Doesn't depend on the url having an established node. */
        return (my.storage_root_url
                && (url.slice(0, my.storage_root_url.length)
                    === my.storage_root_url)); }
    /** True if the URL is for a content item in the user's storage area.
     * Does not include the original shares root.
     * Doesn't depend on the url having an established node. */
    function is_share_url(url) {
        return (my.public_shares_root_url
                && (url.slice(0, my.public_shares_root_url.length)
                    === my.public_shares_root_url)); }
    /** True if the URL is for a non-content DOM page */
    function is_panel_url(url) {
        return generic.panels_by_url.hasOwnProperty(url); }
    /** True if url within registered roots. */
    function is_node_url(url) {
        // Consider sans query string, if any.
        url = id2url(url.split('?')[0]);
        return (is_storage_url(url)
                || is_panel_url(url)
                || is_share_url(url)
                || is_combo_root_url(url)
                || is_root_url(url)); }

    function public_share_room_urls_list() {
        /* Return an array of public share room urls being visited. */
        return Object.keys(generic.public_share_room_urls); }
    function original_share_room_urls_list() {
        /* Return an array of original share room urls being visited. */
        return Object.keys(my.original_share_room_urls); }

    /* ===== Data model ==== */

    /* Nodes coordinate data - remote content details, settings, account
       info - and DOM presentation.  The collection is managed by the
       node_manager, where the nodes are addressed by their url. */

    function Node(url, parent) {
        /* Constructor for any kinds of managed items.
           'url' - address by which item is retrived from node_manager. For
                   remotely managed content, it's the remote-data access URL.
           'parent' - containing node
        */
        if (! (this instanceof Node)) {      // Coding failsafe.
            throw new Error("Constructor called as a function");
        }
        if (url) {             // Skip if we're in prototype assignment.
            this.url = url;
            this.name = "";
            this.root_url = parent ? parent.root_url : url;
            this.parent_url = parent ? parent.url : null;
            /** Dynamically assigned to most recently occupied content tab. Use
             * current_tab_manager.get_recent_tab_url() for the right value. */
            this.recent_tab_url = null;
            this.$page = null;  // This node's jQuery-ified DOM data-role="page"
            this.emblem = "";   // At least for debugging/.toString()
            this.icon_path = ""; }}
    Node.prototype.free = function () {
        /* Free composite content to make available for garbage collection. */
        if (this.$page) {
            this.$page.remove();
            this.$page = null; }}

    /**
     * Return the object which contains the bunch of objects including this one.
     *
     * Specifically, return the object in the chain of parents which is
     * situated in one of the root objects.
     *
     * @this {Node}
     */
    Node.prototype.outer_container = function () {
        if (! this.parent_url) {
            return null;
        } else if (is_root_url(this.parent_url)) {
            return this;
        } else {
            var parent = node_manager.get(this.parent_url)
            return parent.container() || parent;
        }
    }

    /**
     * UI panel pages that present specific sets of options or item details.
     *
     * Panels are used to present settings options and/or detailed
     * information about individual content items. Their furnishing
     * facilities provide for filling in variables, and they provide for
     * receiving submitted changes.
     *
     * @constructor
     * @this {PanelNode}
     * @param {string} url The (reserved, internal) address of this panel.
     * @param {ContentNode} parent The immediately containing panel or item.
     */
    function PanelNode(url, parent) {
        Node.call(this, url, parent);
        if (url) {             // Skip if we're in prototype assignment.
            // Assume that the url fragment is the object's DOM id:
            this.id = url.split('/').pop();
            // All panels have the root panel as parent.
            this.parent_url = id2url(generic.panel_root_page_id);
            this.$page = $('#' + this.id);
            this.query_qualifier = "";
            this.subdirs = [];  // Sub-panels
            this.emblem = "Settings";
            this.name = "Settings";
            this.emblem = ""; }}
    PanelNode.prototype = new Node();

    /**
     * Root panel.
     *
     * @constructor
     * @this {RootPanelNode}
     * @param {string} url The (reserved, internal) address of this root panel.
     * @param {ContentNode} parent The immediately containing item.
     */
    function RootPanelNode(url, parent) {
        PanelNode.call(this, url, parent);
        this.root_url = url;
        this.emblem = "Settings";
        this.name = "Settings"; }
    RootPanelNode.prototype = new PanelNode();


    /**
     * Items that represent remote, service-managed content.
     *
     * ContentNodes represent service-managed content. That includes
     * distinct manifestations of storage (backups) content and share
     * rooms. Content-specific roots encompass the various remote content
     * collections.  An extrapolated RootContentNode, aka the "combo root",
     * consolidates them all.
     *
     * See JSON data examples in docs/api_json_examples.txt
     *
     * @constructor
     * @this {ContentNode}
     * @param {string} url The address of the remote content item.
     * @param {ContentNode} parent The immediately containing item.
     */
    function ContentNode(url, parent) {
        Node.call(this, url, parent);
        if (url) {             // Skip if we're in prototype assignment.
            this.query_qualifier = "";
            this.subdirs = [];  // Urls of contained devices, folders.
            this.files = [];    // Urls of contained files.
            this.lastfetched = false;
            this.emblem = "";   // At least for debugging/.toString()
            this.icon_path = ""; }}
    ContentNode.prototype = new Node();

    function StorageNode(url, parent) {
        ContentNode.call(this, url, parent);
        // All but the root storage nodes are contained within a device.
        // The DeviceStorageNode sets the device url, which will trickle
        // down to all its contents.
        this.device_url = parent ? parent.device_url : null; }
    StorageNode.prototype = new ContentNode();
    function ShareNode(url, parent) {
        /* Share room abstract prototype for collections, rooms, and contents */
        ContentNode.call(this, url, parent);
        this.root_url = parent ? parent.root_url : null;
        this.room_url = parent ? parent.room_url : null; }
    ShareNode.prototype = new ContentNode();

    /**
     * Consolidated root of the storage and share content hierarchies.
     */
    function RootContentNode(url, parent) {
        ContentNode.call(this, url, parent);
        this.root_url = url;
        this.emblem = brand.title;
        this.name = "My Stuff";
        delete this.subdirs;
        delete this.files; }
    RootContentNode.prototype = new ContentNode();
    RootContentNode.prototype.free = function () {
        /* Free composite content to make available for garbage collection. */
        if (this.$page) {
            // Do not .remove() the page - it's the original, not a clone.
            this.$page = null; }}
    RootContentNode.prototype.loggedin_ish = function () {
        /* True if we have enough info to be able to use session credentials. */
        return (my.username && true); }

    function RootStorageNode(url, parent) {
        StorageNode.call(this, url, parent);
        this.query_qualifier = "?" + generic.devices_query_expression;
        this.emblem = "Root Storage";
        this.stats = null;
        delete this.files; }
    RootStorageNode.prototype = new StorageNode();
    function RootShareNode(url, parent) {
        ShareNode.call(this, url, parent);
        this.emblem = "Root Share";
        this.root_url = url; }
    RootShareNode.prototype = new ShareNode();

    function RecentContentsNode(url, parent) {
        ContentNode.call(this, url, parent);
        this.emblem = "Recently Visited Items";
        // We'll use subdirs for the items - we care not about the types:
        this.items = this.subdirs;
        delete this.files; }
    RecentContentsNode.prototype = new ContentNode();

    /**
     * "Favorite" items container.
     *
     * Contains "favorites" - items, selected by the user, for which locally
     * cached copies are maintained.
     *
     * @constructor
     * @this {FavoriteContentsNode}
     * @param {string} url The (reserved, internal) address of this container.
     * @param {ContentNode} parent The immediately containing item.
     */
    function FavoriteContentsNode(url, parent) {
        ContentNode.call(this, url, parent);
        this.emblem = "Not Yet Implemented: Favorites";
        // We'll use subdirs for the items - we care not about the types:
        this.items = this.subdirs;
        delete this.files; }
    FavoriteContentsNode.prototype = new ContentNode();

    function PublicRootShareNode(url, parent) {
        RootShareNode.call(this, url, parent);
        this.name = "Share Rooms";
        this.emblem = "Share Rooms";
        this.job_id = 0; }
    OriginalRootShareNode.prototype = new RootShareNode();
    function OriginalRootShareNode(url, parent) {
        RootShareNode.call(this, url, parent);
        this.name = "My Share Rooms";
        this.emblem = "Originally Published Share Rooms"; }
    PublicRootShareNode.prototype = new RootShareNode();

    function DeviceStorageNode(url, parent) {
        StorageNode.call(this, url, parent);
        this.emblem = "Storage Device";
        this.device_url = url; }
    DeviceStorageNode.prototype = new StorageNode();
    function RoomShareNode(url, parent) {
        ShareNode.call(this, url, parent);
        this.emblem = "Share Room";
        this.room_url = url;
        var splat = url.split('/');
        if (splat[splat.length-1] === "") {
            splat.pop(); }
        this.share_id = base32.decode(splat[splat.length-2]);
        this.room_key = splat[splat.length-1]; }
    RoomShareNode.prototype = new ShareNode();

    function FolderContentNode(url, parent) {
        /* Stub, for situating intermediary methods. */ }
    function FileContentNode(url, parent) {
        /* Stub, for situating intermediary methods. */ }

    function FolderStorageNode(url, parent) {
        this.emblem = "Storage Folder";
        StorageNode.call(this, url, parent); }
    FolderStorageNode.prototype = new StorageNode();
    function FolderShareNode(url, parent) {
        this.emblem = "Share Room Folder";
        ShareNode.call(this, url, parent); }
    FolderShareNode.prototype = new ShareNode();

    function FileStorageNode(url, parent) {
        this.emblem = "Storage File";
        StorageNode.call(this, url, parent);
        delete this.subdirs;
        delete this.files; }
    FileStorageNode.prototype = new StorageNode();
    function FileShareNode(url, parent) {
        this.emblem = "Share Room File";
        ShareNode.call(this, url, parent);
        delete this.subdirs;
        delete this.files; }
    FileShareNode.prototype = new ShareNode();

    /* ===== Content type and role predicates ==== */

    ContentNode.prototype.is_root = function () {
        /* True if the node is a collections top-level item. */
        return (this.url === this.root_url); }

    ContentNode.prototype.is_device = function() {
        return false; }
    DeviceStorageNode.prototype.is_device = function() {
        return true; }


    /* ===== Panel access ==== */

    /**
     * Constitute and present a panel item.
     *
     * @this {PanelNode}
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     */
    PanelNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }
        this.layout(mode_opts);
        this.show(page_opts, mode_opts); }

    /**
     * Constitute and present the root panel.
     *
     * @this {RootPanelNode}
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     */
    RootPanelNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }
        PanelNode.prototype.visit.call(this, page_opts, mode_opts);
    }

    PanelNode.prototype.layout = function (page_opts, mode_opts) {
        /* Deploy options page. */
        this.layout_header(mode_opts);
        //this.adjust_settings(page_opts); // XXX include call in other types, too
        this.layout_footer(mode_opts);
    }

    /** Adjust page content according to settings.
     *
     * This is the bridge between presentation and manifestation of user
     * settings and other state.
     *
     * @param {object} mode_opts User settings and operation mode options
     */
    Node.prototype.adjust_settings = function (mode_opts) {
        /* We take the mode_opts.var_name and mode_opts.var_value and:
         *
         * 1. Establish setting per mode_opts.var_name, var_val, var_val_pretty
         * 2. adjust page var slots per the prevailing settings - check, etc
         * 2. adjust page per the prevailing settings
         * 3. adjust page value slots per the prevailing settings
         * 4. adjust page assignment items so their hrefs convey the settings
         */

        /** Adjust page variable display slots with the current values.
         *
         * We use settings_manager.get_immediate(), since we are used as
         * the success callback on promises for settings_manager.get()
         *
         * Handles the various kinds of slots so-setting-display=[*], currently:
         * - "content": Spans where the text content is the variable value
         * - "checkbox": listview li with checkbox for the specific setting
         * - "button": input buttons needing activation adjustments
         *
         * @param {object} page$ The target jQm page
         */
        function apply_settings_values($page) {
            var $contents = $page.find('[so-setting-display="content"]'),
                $checkboxes = $page.find('[so-setting-display="checkbox"]'),
                $buttons = $page.find('[so-setting-display="button"]');
            $contents.map(
                function (i) {
                    var $item = $contents[i];
                    $item.html(
                      setmgr.get_immediate($item.getAttribute('so-setting-name')
                                           || "")); });
            $checkboxes.map(
                function (i) {
                    var $item = $checkboxes[i],
                        name = $item.getAttribute('so-setting-name'),
                        val = $item.getAttribute('so-setting-value');
                    if (val === setmgr.get_immediate(name)) {
                        // check the checkbox
                        ;
                    }
                } );
        }
        var $mypage = this.my_page$();
        var result_promise;
        if (mode_opts && mode_opts.hasOwnProperty('var_name')) {
            result_promise = settings_manager.set(mode_opts.var_name,
                                                  mode_opts.var_val,
                                                  mode_opts.var_val_pretty);
            if (result_promise.state() === "pending") {
                // Since the promise is not already resolved, we need to:
                //
                // - show a busy cursor until it is
                // - then deactivate the busy cursor on conclusion
                // - and update the settings if the promise is fulfilled,
                // - or else post a toast indicating what went wrong.

                $.mobile.loading('show');
                result_promise.always(function () { $.mobile.loading('hide'); })

                // On success, apply settings once again - the newly
                // established value will be incorporated.
                // TECH NOTE: We re-process all settings on the page,
                // rather than just the one that we know changed, because
                // some settings values are derived from others, and we
                // can't, ab initio, identify which might be affected.
                result_promise.done(
                    function () { apply_settings_values($mypage); }) ;

                // On reject, post info as toast and console log. We do not
                // include the value because it may be sensitive.
                result_promise.fail(function (err)
                                    { msg = ("Failed to set " + var_name
                                             + ": " + err)
                                      console.log(msg);
                                      toastish(msg, 3);}); }
        }
        apply_settings_values($mypage);
    }

    /* ===== Remote data access ==== */

    /**
     * Constitute and present a remote data item.
     *
     * Fetch current data from server, provision, layout, and present.
     *
     * @this {ContentNode}
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
    */
    ContentNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }

        if (! this.up_to_date()) {
            this.fetch_and_dispatch(page_opts, mode_opts); }
        else {
            this.show(page_opts, mode_opts); }}

    /**
     * Do the special visit of the consolidated storage/share root
     *
     * Trigger visits to the respective root content nodes in 'passive'
     * mode so they do not focus the browser on themselves. 'notify' mode
     * is also provoked, so they report their success or failure to our
     * notify_subvisit_status() method.
     *
     * See docs/AppOverview.txt "Content Node navigation modes" for
     * details about mode controls.
     *
     * @this (RootContentNode)
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     */
    RootContentNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }

        this.remove_status_message();
        if (SO_DEBUGGING.match(/:verbose:/)) {
            this.show_status_message("Using base_host_url "
                                     + generic.base_host_url); }

        this.show(page_opts, {});
        $.mobile.loading('show');

        if (mode_opts && mode_opts.logout) {
            this.logout();
            return true; }

        // We always dispatch the public shares visit:
        var public_mode_opts = {passive: true,
                                notify_callback:
                                    this.notify_subvisit_status.bind(this),
                                notify_token: 'public-shares-token'};
        $.extend(public_mode_opts, mode_opts);
        var public_root = nmgr.get(my.public_shares_root_url,
                                   my.public_shares_root_url);
        public_root.visit(page_opts, public_mode_opts);

        if (! this.loggedin_ish()) {
            // Not enough registered info to try authenticating:
            this.authenticated(false);
            this.layout(mode_opts);
            this.show(page_opts, {}); }

        else {
            var storage_root = node_manager.get(my.storage_root_url, this);
            // Use a distinct copy of mode_opts:
            var storage_mode_opts = $.extend({}, public_mode_opts);
            storage_mode_opts.notify_token = 'storage-token';
            // Will chain to original shares via notify_callback.
            $.mobile.loading('show');
            storage_root.visit(page_opts, storage_mode_opts); }}

    /**
     * Present the accumulated list of recently visited items.
     *
     * @this (RecentContentsNode)
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     */
    RecentContentsNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }

        // (Could mode_opts.hasOwnProperty('action') for recents editing.)

        this.layout($.extend({no_dividers: true}, mode_opts));
        this.show(page_opts, mode_opts); }

    /**
     * Focus on the list of selected favorite items.
     *
     * @this {FavoriteContentsNode}
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     */
    FavoriteContentsNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }
        this.layout(mode_opts);
        this.show(page_opts, mode_opts); }

    /**
     * Obtain the known, non-original share rooms and present them.
     *
     * Our content is the set of remembered urls, from:
     * - those visited in this session
     * - those remembered across sessions
     *
     * @this {PublicRootShareNode}
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     */
    PublicRootShareNode.prototype.visit = function (page_opts, mode_opts) {
        if (! mode_opts.passive) {
            current_tab_manager.set_current_from(this); }

        this.remove_status_message('result');
        this.remove_status_message('error');

        if (mode_opts.hasOwnProperty('action')) {
            var action = mode_opts.action;
            if (this[action] && this[action].is_action) {
                var got = this[action](mode_opts.subject);
                this.do_presentation(page_opts, {});
                return got; }}

        // this.add_item() only adds what's missing, and sets this.subdirs.
        this.get_subdir_prospects().map(this.add_item.bind(this));
        this.do_presentation(page_opts, mode_opts); }

    PublicRootShareNode.prototype.get_subdir_prospects = function () {
        /* Load the subdirs list from active list and persistence. */
        var subdirs = public_share_room_urls_list();
        var persisted = persistence_manager.get('public_share_urls') || {};
        var additions = [];
        Object.keys(persisted).map(function (item) {
            if (subdirs.indexOf(item) === -1) {
                additions.push(item); }});
        return subdirs.concat(additions); }

    /** Retrieve this node's data and deploy it.
     *
     *
     *
     * - On success, call this.handle_visit_success() with the retrieved
     * JSON data, new Date() just prior to the retrieval, page_opts,
     *  mode_opts, a text status categorization, and the XMLHttpRequest
     * object.
     * - Otherwise, this.handle_visit_failure() is called with the
     * XMLHttpResponse object, page_opts, mode_opts, the text status
     * categorization, and an exception object, present if an exception
     * was caught.
     *
     * See the jQuery.ajax() documentation for XMLHttpResponse details.
     *
     * @this {ContentNode}
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     * @param {number} tried Optional number of prior tries, zero if undefined.
    */
    ContentNode.prototype.fetch_and_dispatch = function (page_opts,
                                                         mode_opts,
                                                         tried) {
        /* DOING 'tried' implementation not yet complete. */
        if (! tried) {
            tried = 0; }
        var when = new Date();
        var url = this.url + this.query_qualifier;
        $.ajax({url: url,
                type: 'GET',
                dataType: 'json',
                cache: false,
                success: function (data, status, xhr) {
                    this.handle_visit_success(data, when,
                                              page_opts, mode_opts,
                                              status, xhr); }.bind(this),
                error: function (xhr, statusText, thrown) {
                    this.handle_visit_failure(xhr, page_opts, mode_opts,
                                              statusText,
                                              thrown,
                                              tried)}.bind(this), })}

    RootContentNode.prototype.notify_subvisit_status = function(succeeded,
                                                                token,
                                                                response) {
        /* Callback passed to subordinate root content nodes to signal their
           update disposition:
           'succeeded': true for success, false for failure.
           'token': token they were passed to identify the transaction,
           'response': on failure: the resulting XHR object. */

        if (token !== 'public-shares-token') {
            this.authenticated(true); }

        var $page = this.my_page$();

        if (! succeeded) {
            this.logout(); }
        else {
            // Unnecessary relayout of header and footer is future-proofing:
            this.layout();

            if (token === 'storage-token') {
                // Ensure we're current page and chain to original shares root.

                this.layout({}, {});
                this.show({}, {});

                var our_mode_opts = {passive: true,
                                     notify_callback:
                                       this.notify_subvisit_status.bind(this),
                                     notify_token: 'myshares-token'};
                this.authenticated(true, response);
                var ps_root = nmgr.get(my.my_shares_root_url, this);
                ps_root.visit({}, our_mode_opts); }
            else {
                $.mobile.loading('hide'); }}}

    PublicRootShareNode.prototype.notify_subvisit_status = function(succeeded,
                                                                   token,
                                                                   content) {
        /* Callback for subordinate share nodes to signal their visit result:
           'succeeded': true for success, false for failure.
           'token': token we passed in to identify transaction and convey info:
                    [job_id, subnode_URL],
           'content': on success: the jquery $(dom) for the populated content,
                      for failure: the resulting XHR object. */
        // We ignore the content.

        var $page = this.my_page$();
        var sub_job_id = token[0];
        var url = token[1];
        var splat = url.split('/');
        if (splat[splat.length-1] === "") {
            splat.pop(); }
        var share_id = base32.decode(splat[splat.length-2]);
        var room_key = splat[splat.length-1];

        if (succeeded !== true) {
            this.remove_status_message('result');
            which_msg += (_t("Share ID")
                          + ' <span class="message-subject">'
                          + share_id + "</span> ");
            var message = (_t("Sorry") + " - " + which_msg + " "
                           + content.statusText + " (" + content.status + ")");
            var remove = true;
            this.show_status_message(message);
            // We may wind up unpersisting items due to a transient problem,
            // but the situation is too complicated to settle by prompting.
            this.remove_item(url);
            this.unpersist_item(url); }
        else {
            this.remove_status_message('error');
            if (this.adding_external) {
                var room = node_manager.get(url);
                var digested_name = (room && room.title()
                                     ? elide(room.title(), 30)
                                     : ("(" + _t("Share ID") + " "
                                        + share_id + ")"));
                var which_msg = ('<span class="message-subject">'
                                 + digested_name + "</span>");
                var $sm = this.show_status_message(_t("Added") +" "+ which_msg,
                                                   'result');
                this.adding_external = false; }
            else {
                this.remove_status_message('result'); }
            if (persistence_manager.get('retaining_visits')) {
                this.persist_item(url); }}

        // Do update, whether or not it was successful:
        this.subdirs = public_share_room_urls_list()
        this.subdirs.sort(content_nodes_by_url_sorter)
        this.do_presentation({}, {passive: true});
        // NOTE: Necessary to avoid skeleton items in init combo-root view.
        //       There should be a better, less arbitrarily intrusive way.
        node_manager.get_combo_root().layout(); }

    ContentNode.prototype.handle_visit_success = function (data, when,
                                                           page_opts,
                                                           mode_opts,
                                                           status, xhr) {
        /* Deploy successfully obtained node data.
           See ContentNode.fetch_and_dispatch() for parameter details. */
        this.provision(data, when, mode_opts);
        this.layout(mode_opts);
        this.show(page_opts, mode_opts);
        if (mode_opts.notify_callback) {
            mode_opts.notify_callback(true,
                                      mode_opts.notify_token); }}

    /** Respond to failure of attempt to visit a remote node.
     *
     * Condition the action depending on the specific error and the number
     * of prior tries - if we've already been through a retry, bail.
     *
     * @this {ContentNode}
     * @param {object} xhr XML HTTP Response object.
     * @param {object} page_opts $.mobile.changePage page change options
     * @param {object} mode_opts User settings and operation mode options
     * @param {object} exception The exception that was thrown.
     * @param {number} tried The number of prior tries.
     */
    ContentNode.prototype.handle_visit_failure = function (xhr,
                                                           page_opts,
                                                           mode_opts,
                                                           exception,
                                                           tried) {
        if ((xhr.status === 401) && (tried === 0)) {
            // Unauthorized and this is our first retry -
            // attempt to reauthenticate and repeat the visit.
            // XXX Should this go in the root content node?
            /* DOING 'tried' implementation not yet complete. */
        }
        if (mode_opts.notify_callback) {
            mode_opts.notify_callback(false, mode_opts.notify_token, xhr); }
        else {
            $.mobile.loading('hide');
            alert("Visit '" + this.name + "' failed: "
                  + xhr.statusText + " (" + xhr.status + ")");
            var combo_root = node_manager.get_combo_root();
            if (! is_combo_root_url(this.url)) {
                // Recover upwards, eventually to the top:
                $.mobile.changePage(this.parent_url
                                    ? this.parent_url
                                    : combo_root.url); }}}

    RootContentNode.prototype.handle_visit_failure = function (xhr,
                                                               page_opts,
                                                               mode_opts,
                                                               exception,
                                                               tried) {
        /* Do failed visit error handling with 'xhr' XMLHttpResponse report. */
        /* DOING 'tried' implementation not yet complete. */
        this.layout();
        this.authenticated(false, xhr, exception); }

    RootContentNode.prototype.authenticated = function (succeeded, response,
                                                        exception) {
        /* Present login challenge versus content, depending on access success.
           'succeeded': true for success, false for failure.
           'response': on failure: the resulting XHR object, if any.
           'exception': on failure, exception caught by ajax machinery, if any.
         */
        var $page = this.my_page$();
        var $content_section = $page.find('.my-content');
        var $login_section = $page.find('.login-section');

        if (succeeded) {
            // Show the content instead of the form
            $login_section.hide();
            $("#my-storage-leader").show();
            $("#my-rooms-leader").show();
            this.remove_status_message();
            $content_section.show();
            if (remember_manager.active()) {
                // remember_manager will store just the relevant fields.
                remember_manager.store(my);
                this.layout_header(); }}
        else {
            // Include the xhr.statusText in the form.
            $content_section.hide();
            $("#my-storage-leader").hide();
            $("#my-rooms-leader").hide();
            $login_section.show();
            var username;
            if (remember_manager.active()
                && (username = persistence_manager.get('username'))) {
                $('#my_login_username').val(username); }
            if (response) {
                var error_message = response.statusText;
                if (exception) {
                    error_message += " - " + exception.message; }
                this.show_status_message(error_message);
                if (response.status === 401) {
                    // Unauthorized - expunge all privileged info:
                    clear_storage_account(); }}
            // Hide the storage and original shares sections
            $content_section.hide();
        }}

    PublicRootShareNode.prototype.actions_menu_link = function (subject_url) {
        /* Create a menu for 'subject_url' using 'template_id'.  Return an
           anchor object that will popup the menu when clicked. */

        var href = ('#' + this.url
                    + '?action=enlisted_room_menu&subject='
                    + subject_url)
        href = transit_manager.distinguish_url(href);

        var $anchor = $('<a/>');
        $anchor.attr('href', href);
        $anchor.attr('data-icon', 'gear');
        $anchor.attr('title', "Actions menu");
        // Return it for deployment:
        return $anchor; }

    PublicRootShareNode.prototype.enlisted_room_menu = function (subject_url) {
        /* For an enlisted RoomShareNode 'subject_url', furnish the simple
         * popup menu with context-specific actions. */

        var fab_anchor = function (action, subject_url, icon_name, item_text) {
            var href = (this.here() + '?action=' + action
                        + '&subject=' + subject_url);
            return ('<a href="' + href + '" data-icon="' + icon_name + '"'
                    + 'data-mini="true" data-iconpos="right">'
                    + item_text + '</a>')}.bind(this);

        var $popup = $('#' + generic.titled_choice_popup_id);
        var $listview = $popup.find('[data-role="listview"]');
        // Ditch prior contents:
        $listview.empty()

        var subject_room = node_manager.get(subject_url);
        $popup.find('.title').html('<span class="subdued">Room: </span>'
                                   + elide(subject_room.title(), 50));
        $popup.find('.close-button').attr('href',
                                          this.here() + '?refresh=true');

        var $remove_li = $('<li/>');
        $remove_li.append(fab_anchor('remove_item_external',
                                     subject_url,
                                     'delete',
                                     _t("Drop this room from the list")));

        var $persistence_li = $('<li/>');
        if (this.is_persisted(subject_url)) {
            $persistence_li.append(fab_anchor('unpersist_item',
                                              subject_url,
                                              'minus',
                                              _t("Stop retaining across"
                                                 + " sessions"))); }
        else {
            $persistence_li.append(fab_anchor('persist_item',
                                              subject_url,
                                              'plus',
                                              "Retain across sessions")); }
        $listview.append($remove_li, $persistence_li);

        // popup handlers apparently not actually implemented as of 2012-07-01.
        //var handlers = {opened: function (event, ui) {
        //                    console.log('opened'); },
        //                closed: function (event, ui) {
        //                    console.log("popup closed"); }}
        //$popup.popup(handlers);
        $popup.popup();
        $popup.parent().page();
        $listview.listview('refresh');
        $popup.popup('open');
    }
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.enlisted_room_menu.is_action = true;

    /**
     * Register a visit to a {@link ContentNode} address.
     *
     * @this {ContentsNode}
     * @param {string} url The address of the ContentNode being registered.
     */
    RecentContentsNode.prototype.add_visited_url = function (url) {
        /* Register a recent visit.  Omit our own address and any
           duplicates, disregarding query parameters. */
        url = url.split('?')[0];
        if ((url !== this.url)
            && (! is_noncontent_node(node_manager.get(url)))) {
            var was = this.items.indexOf(url);
            if (was !== 0) {
                // If the item isn't already the first.
                if (was !== -1) {
                    this.items.splice(was, 1); }
                this.items.unshift(url);
                // Truncate to max size, with no effect if not there:
                this.items.splice(generic.recents_max_size);

                // XXX Un-elide following to exercise favorites registration:
                //node_manager.get_favorites().add_favorite_url(url);
            }}}

    /**
     * Register a {@link ContentNode}'s address as a favorite.  Returns 1
     * if added, else 0.
     *
     * Favorites are persistently tallied, and cached locally so they are
     * available even when offline.  An Error is thrown if the item is
     * already a favorite.  Not Yet Implemented: We should refuse to add
     * items when that would exceed the favorites storage limit.
     *
     * @this {FavoriteContentsNode}
     * @param {string} url The address of the ContentNode being added.
     */
    FavoriteContentsNode.prototype.add_favorite_url = function (url) {
        url = url.split('?')[0];
        /* XXX Check for capacity, overage, etc. */
        if ((url !== this.url)) {
            if (this.items.indexOf(url) !== -1) {
                return 0
            } else {
                var cursor = 0;
                while ((cursor < this.items.length)
                       && (url > this.items[cursor])) {
                    cursor += 1; }
                this.items.splice(cursor, 0, url);
                return 1; }}}

    PublicRootShareNode.prototype.add_item_external = function (credentials) {
        /* Visit a specified share room, according to 'credentials' object:
           {username, password}.
           Use this routine only for the form add.  Use this.add_item(),
           instead, for internal operation.
        */

        this.job_id += 1;       // Entry

        var share_id = credentials.shareid;
        var room_key = credentials.password;
        var new_share_url = (my.public_shares_root_url
                             + base32.encode_trim(share_id)
                             + "/" + room_key
                             + "/");
        if (is_public_share_room_url(new_share_url)) {
            this.remove_status_message('result');
            var room = node_manager.get(new_share_url);
            var digested_title = ((room && room.title())
                                  ? elide_per(room.title())
                                  : "(" + _t("Share ID") +" " + share_id + ")");
            var message = (_t("Room")
                           + ' <span class="message-subject">'
                           + digested_title + "</span> "
                           + _t("already added"))
            this.show_status_message(message, 'error'); }
        else {
            this.remove_status_message('error');
            var $sm = this.show_status_message(_t("Working..."),
                                               'result');
            this.adding_external = true;
            $sm.hide();
            $sm.fadeIn(2000); // Give time for error to appear.
            return this.add_item(new_share_url); }}

    PublicRootShareNode.prototype.add_item = function (url) {
        /* Visit a specified share room, according its' URL address.
           Return the room object. */
        register_public_share_room_url(url);
        var room = node_manager.get(url, this);
        room.visit({},
                   {passive: true,
                    notify_callback: this.notify_subvisit_status.bind(this),
                    notify_token: [this.job_id, url]});
        this.subdirs = public_share_room_urls_list();
        return room; }


    PublicRootShareNode.prototype.remove_item_external = function (room_url) {
        /* Omit a non-original share room from persistent and resident memory.
           This is for use from outside of the object. Use .remove_item() for
           internal object operation. */
        this.job_id += 1;
        var splat = room_url.split('/');
        if (splat[splat.length-1] === "") {
            splat.pop(); }
        var share_id = base32.decode(splat[splat.length-2]);
        var room_key = splat[splat.length-1];
        var room = node_manager.get(room_url);
        var digested_name = ((room && room.title())
                             ? elide_per(room.title())
                             : "(Share ID " + share_id + ")")
        var message = ("Public share room "
                       + '<span class="message-subject">'
                       + digested_name + "</span>");

        if (! is_public_share_room_url(room_url)) {
            this.show_status_message(message + " " + _t("not found."),
                                     'error'); }
        else {
            this.remove_status_message('error');
            this.adding_external = true;
            this.remove_item(room_url);
            this.show_status_message(message + " " + _t("removed."),
                                     'result'); }}
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.remove_item_external.is_action = true;

    PublicRootShareNode.prototype.remove_item = function (room_url) {
        /* Omit a non-original share room from the persistent and resident
           collections. Returns true if the item was present, else false. */
        if (is_public_share_room_url(room_url)) {
            if (! is_original_share_room_url(room_url)) {
                // Free the nodes.
                node_manager.clear_hierarchy(room_url); }
            unregister_public_share_room_url(room_url);
            this.unpersist_item(room_url);
            this.subdirs = public_share_room_urls_list();
            return true; }
        else { return false; }}

    OriginalRootShareNode.prototype.clear_item = function (room_url) {
        /* Omit an original share room from the resident collection.
           (The share room is not actually removed on the server.)
           Returns true if the item was present, else false. */
        if (is_original_share_room_url(room_url)) {
            if (! is_public_share_room_url(room_url)) {
                // Free the nodes.
                node_manager.clear_hierarchy(room_url); }
            unregister_original_share_room_url(room_url);
            return true; }
        else { return false; }}

    PublicRootShareNode.prototype.persist_item = function (room_url) {
        /* Add a share rooms to the collection persistent non-originals. */
        var persistents = pmgr.get('public_share_urls') || {};
        if (! persistents.hasOwnProperty(room_url)) {
            persistents[room_url] = true;
            pmgr.set("public_share_urls", persistents); }}
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.persist_item.is_action = true;

    PublicRootShareNode.prototype.unpersist_item = function (room_url) {
        /* Omit a non-original share room from the persistent
           collection.  Returns true if the item was present, else false. */
        var persistents = pmgr.get("public_share_urls") || {};
        if (persistents.hasOwnProperty(room_url)) {
            delete persistents[room_url];
            pmgr.set('public_share_urls', persistents);
            return true; }
        else { return false; }}
    // Whitelist this method for use as a mode_opts 'action':
    PublicRootShareNode.prototype.unpersist_item.is_action = true;

    PublicRootShareNode.prototype.is_persisted = function (room_url) {
        var persisteds = persistence_manager.get('public_share_urls') || {};
        return persisteds.hasOwnProperty(room_url); }

    /* ===== Containment ==== */
    /* For node_manager.clear_hierarchy() */

    ContentNode.prototype.contained_urls = function () {
        return [].concat(this.subdirs, this.files); }
    RootContentNode.prototype.contained_urls = function () {
        return [].concat(this.storage_devices,
                         this.my_shares, this.shares); }
    RootStorageNode.prototype.contained_urls = function () {
        return [].concat(this.subdirs); }
    FileStorageNode.prototype.contained_urls = function () {
        return []; }
    FileShareNode.prototype.contained_urls = function () {
        return []; }

    /**
     * True if this content object immediately contains the target object.
     *
     * @this {Node}
     * @param {ContentNode} target object which may be immediately contained
     */
    ContentNode.prototype.contains = function (target) {
        return this.contained_urls().indexOf(target.url) !== -1;
    }

    /* ==== Provisioning - Data model assimilation of fetched data ==== */

    ContentNode.prototype.provision = function (data, when, mode_opts) {
        /* Populate node with JSON 'data'. 'when' is the data's current-ness.
           'when' should be no more recent than the XMLHttpRequest.
        */
        this.provision_preliminaries(data, when, mode_opts);
        this.provision_populate(data, when, mode_opts); }

    ContentNode.prototype.provision_preliminaries = function (data, when,
                                                              mode_opts) {
        /* Do provisioning stuff generally useful for derived types. */
        if (! when) {
            throw new Error("Node provisioning without reliable time stamp.");
        }
        this.up_to_date(when); }

    ContentNode.prototype.provision_populate = function (data, when,
                                                         mode_opts) {
        /* Stub, must be overridden by type-specific provisionings. */
        error_alert("Not yet implemented",
                    this.emblem
                    + " type-specific provisioning implementation"); }

    ContentNode.prototype.provision_items = function (data_items,
                                                      this_container,
                                                      url_base, url_element,
                                                      fields,
                                                      contents_parent) {
        /* Register data item fields into subnodes of this node:
           'data_items' - the object to iterate over for the data,
           'this_container' - the container into which to place the subnodes,
           'url_base' - the base url onto which the url_element is appended,
           'url_element' - the field name for the url of item within this node,
           'fields' - an array of field names for properties to be copied (1),
           'contents_parent' - the node to attribute as the subnodes parent (2).

           (1) Fields are either strings, denoting the same attribute name in
               the data item and subnode, or two element subarrays, with the
               first element being the data attribute name and the second being
               the attribute name for the subnode.
           (2) The contained item's parent is not always this object, eg for
               the content roots. */
        var parent = node_manager.get(contents_parent);
        data_items.map(function (item) {
            var url = url_base + item[url_element];
            var subnode = node_manager.get(url, parent);
            fields.map(function (field) {
                if (field instanceof Array) {
                    subnode[field[1]] = item[field[0]]; }
                else {
                    if (typeof item[field] !== "undefined") {
                        subnode[field] = item[field]; }}})
            if (subnode.name && (subnode.name[subnode.name.length-1] === "/")) {
                // Remove trailing slash.
                subnode.name = subnode.name.slice(0, subnode.name.length-1); }
            // TODO Scaling - make subdirs an object for hashed lookup?
            if (this_container.indexOf(url) === -1) {
                this_container.push(url); }})}

    RootStorageNode.prototype.provision_populate = function (data, when,
                                                             mode_opts) {
        /* Embody the root storage node with 'data'.
           'when' is time soon before data was fetched. */
        var combo_root = node_manager.get_combo_root();
        var url, dev, devdata;

        this.name = my.username;
        // TODO: We'll cook stats when UI is ready.
        this.stats = data["stats"];

        this.subdirs = [];
        this.provision_items(data.devices, this.subdirs,
                             this.url, 'encoded',
                             ['name', 'lastlogin', 'lastcommit'],
                             my.combo_root_url);

        this.lastfetched = when; }

    FolderContentNode.prototype.provision_populate = function (data, when) {
        /* Embody folder content items with 'data'.
           'when' is time soon before data was fetched. */

        this.subdirs = [];
        this.provision_items(data.dirs, this.subdirs, this.url, 1,
                             [[0, 'name']], this.url);

        if (data.hasOwnProperty('files')) {
            this.files = [];
            var fields = ['name', 'size', 'ctime', 'mtime', 'versions'];
            generic.preview_sizes.map(function (size) {
                /* Add previews, if any, to the fields. */
                if (("preview_" + size) in data.files) {
                    fields.push("preview_" + size); }})
            this.provision_items(data.files, this.files, this.url, 'url',
                                 fields, this.url);
            if (this.name && (this.name[this.name.length-1] === "/")) {
                // Remove trailing slash.
                this.name = this.name.slice(0, this.name.length-1); }
        }

        this.lastfetched = when; }

    OriginalRootShareNode.prototype.provision_populate = function (data, when) {
        /* Embody the root share room with 'data'.
           'when' is time soon before data was fetched. */
        this.subdirs = [];
        var room_base = my.public_shares_root_url + data.share_id_b32 + "/";
        // Introduce a room.room_tail with trailing slash:
        data.share_rooms.map(function (room) {
            if (room.room_key[room.room_key.length-1] !== "/") {
                room.room_tail = room.room_key + "/"; }
            else { room.room_tail = room.room_key; }});
        this.provision_items(data.share_rooms, this.subdirs,
                             room_base, 'room_tail',
                             [['room_name', 'name'],
                              ['room_description', 'description'],
                              'room_key', 'share_id'],
                             my.combo_root_url);
        this.subdirs.map(function (url) {
            /* Ensure the contained rooms urls are registered as originals. */
            register_original_share_room_url(url); });

        this.lastfetched = when; }

    DeviceStorageNode.prototype.provision_populate = function (data, when) {
        /* Embody storage folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderStorageNode.prototype.provision_populate.call(this, data, when); }
    RoomShareNode.prototype.provision_populate = function (data, when) {
        /* Embody storage folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderShareNode.prototype.provision_populate.call(this, data,
                                                              when);
        this.name = data.stats.room_name;
        this.description = data.stats.description;
        this.number_of_files = data.stats.number_of_files;
        this.number_of_folders = data.stats.number_of_folders;
        this.firstname = data.stats.firstname;
        this.lastname = data.stats.lastname;
        this.lastfetched = when; }

    FolderStorageNode.prototype.provision_populate = function (data, when) {
        /* Embody storage folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderContentNode.prototype.provision_populate.call(this, data, when); }
    FolderShareNode.prototype.provision_populate = function (data, when){
        /* Embody share room folder items with 'data'.
           'when' is time soon before data was fetched. */
        FolderContentNode.prototype.provision_populate.call(this, data, when); }
    FileStorageNode.prototype.provision_populate = function (data, when) {
        error_alert("Not yet implemented", "File preview"); }

    ContentNode.prototype.up_to_date = function (when) {
        /* True if provisioned data is considered current.
           Optional 'when' specifies (new) time we were fetched. */
        // The generic case offers no shortcut for determining up-to-date-ness.
        if (when) { this.lastfetched = when; }
        if (! this.lastfetched) { return false; }
        // No intelligence yet.
        return false; }


    /* ==== Content node page presentation ==== */

    Node.prototype.my_page_id = function () {
        /* Set the UI page id, escaping special characters as necessary. */
        return this.url; }
    RootContentNode.prototype.my_page_id = function () {
        return generic.combo_root_page_id; }
    RootStorageNode.prototype.my_page_id = function () {
        return generic.storage_root_page_id; }
    OriginalRootShareNode.prototype.my_page_id = function () {
        return generic.my_shares_root_page_id; }
    PublicRootShareNode.prototype.my_page_id = function () {
        return generic.published_root_page_id; }

    Node.prototype.show = function (page_opts, mode_opts) {
        /* Trigger UI focus on our content layout.
           If mode_opts "passive" === true, don't do a changePage.
         */
        var $page = this.my_page$();
        if ($.mobile.activePage
            && ($.mobile.activePage[0].id !== this.my_page_id())
            && mode_opts
            && (!mode_opts.passive)) {
            // Use $page object so our handler defers to regular jQm traversal:
            $.mobile.changePage($page, page_opts); }
        // Just in case, eg of refresh:
        $.mobile.loading('hide'); }

    PublicRootShareNode.prototype.do_presentation = function (page_opts,
                                                             mode_opts) {
        /* An exceptional, consolidated presentation routine. */
        // For use by this.visit() and this.notify_subvisit_status().
        this.subdirs.sort(content_nodes_by_url_sorter);
        this.layout(mode_opts);
        this.show(page_opts, mode_opts);

        if (mode_opts.notify_callback) {
            mode_opts.notify_callback(true,
                                      mode_opts.notify_token); }}

    ContentNode.prototype.layout = function (mode_opts) {
        /* Deploy content as markup on our page. */
        this.layout_header(mode_opts);
        this.layout_content(mode_opts);
        this.layout_footer(mode_opts); }

    PublicRootShareNode.prototype.layout = function (mode_opts) {
        /* Deploy content as markup on our page. */

        mode_opts.actions_menu_link_creator = this.actions_menu_link.bind(this);
        ContentNode.prototype.layout.call(this, mode_opts);

        var $content_items = this.my_page$().find('.page-content')
        if (this.subdirs.length === 0) {
            $content_items.hide(); }
        else {
            $content_items.show(); }}

    PublicRootShareNode.prototype.show = function (page_opts, mode_opts) {
        /* Deploy content as markup on our page. */
        ContentNode.prototype.show.call(this, page_opts, mode_opts);
        deploy_focus_oneshot('#my_share_id', "pageshow"); }

    RootContentNode.prototype.layout = function (page_opts, mode_opts) {
        /* Do layout arrangements - different than other node types. */
        var $page = this.my_page$();

        this.layout_header(page_opts, mode_opts);
        // Storage content section:
        // We avoid doing layout of these when not authenticated so the
        // re-presentation of the hidden sections doesn't show through.
        var storage_subdirs = (my.storage_root_url
                               && node_manager.get(my.storage_root_url,
                                                   this).subdirs
                               || [])
        this.layout_content(mode_opts, storage_subdirs, false,
                            '.storage-list');

        // My share rooms section:
        var myshares_subdirs = (my.my_shares_root_url
                                && node_manager.get(my.my_shares_root_url,
                                                    this).subdirs
                                || [])
        this.layout_content(mode_opts, myshares_subdirs, false,
                            '.my-shares-list');

        // Public share rooms section:
        var public_share_urls = public_share_room_urls_list();
        var $public_shares_nonempty = $page.find('.other-content');
        var $public_shares_empty = $page.find('.other-no-content');
        if ($public_shares_nonempty.length === 0) {
            // There is any other-content section:
            if ($public_shares_empty.length !== 0) {
                $public_shares_empty.show(); }
        } else {
            // Show section or button depending on whether there are elements:
            if (public_share_urls.length === 0) {
                $public_shares_nonempty.hide();
                $public_shares_empty.show(); }
            else {
                $public_shares_empty.hide();
                $public_shares_nonempty.show();
                this.layout_content(mode_opts, public_share_urls, false,
                                    '.other-shares-list'); }
        }

        this.layout_footer(mode_opts); }

    /** Configure the essential, common header layout, but dont't do the layout.
     *
     * If mode_opts 'alt_page_selector' is passed in, alter that one
     * instead of the node's default page.
     *
     * @this {Node}
     * @return {object} fields Dictionary of layout_header_fields settings
     * @param {object} mode_opts User settings and operation mode options dictionary
     */
    Node.prototype.layout_header = function(mode_opts) {

        // Every node gets the depth path menu.
        var $page = ((mode_opts && mode_opts.alt_page_selector)
                     ? $(mode_opts.alt_page_selector)
                     : this.my_page$());
        var $title = $page.find('[data-role="header"] .header-title');
        bind_replace($title, 'click.SpiderOak',
                     this.depth_path_menu.bind(this));
        bind_replace($title, 'taphold.SpiderOak', go_to_entrance);

        var fields = {};
        fields.title = this.title();
        return fields; }

    /** Do the essential, common header layout (not just configuration).
     *
     * If mode_opts 'alt_page_selector' is passed in, alter that one
     * instead of the node's default page.
     *
     * @this {Node}
     * @return {object} fields Dictionary of layout_header_fields settings
     * @param {object} mode_opts User settings and operation mode options dictionary
     */
    ContentNode.prototype.layout_header = function(mode_opts) {
        var fields = Node.prototype.layout_header.call(this, mode_opts);
        if (this.parent_url) {
            var container = node_manager.get(this.parent_url);
            fields.left_url = '#' + this.parent_url;
            fields.left_label = container.name; }
        this.layout_header_fields(fields);
        return fields; }

    PanelNode.prototype.layout_header = function(mode_opts) {
        /* Do the essential Panel header layout.  If mode_opts
           'alt_page_selector' is passed in, alter that one instead of the
           node's default page. */

        var fields = Node.prototype.layout_header.call(this, mode_opts);
        this.layout_header_fields(fields); }

    Node.prototype.layout_header_fields = function(fields) {
        /* Generalized header layout facility.

           Populate this node's page header with fields settings:

           field.title: html (or just text) with the page label;
           left_url: left-hand button URL; if absent left button not changed;
           left_label: text for left-hand button, or empty to hide the button;
                       left_label = "-" => use the login URL;
           right_url: right-hand button URL; if absent right button not changed;
           right_label: text for right-hand button, or empty to hide the button;
        */
        var $header = this.my_page$().find('[data-role="header"]');
        var $label;

        if (fields.hasOwnProperty('title')) {
            var $header_div = $('<div data-role="button" data-theme="none"/>');
            $header_div.attr('class', "header-title-button");
            if ((! (this instanceof RootContentNode))
                || this.loggedin_ish()) {
                $header_div.attr('data-icon', "arrow-d"); }
            $header_div.attr('data-iconpos', "right");
            $header_div.attr('data-inline', "true");
            var $icon = this.my_icon_image$("so-image-icon");
            var $title = $('<span class="header-title-text"/>')
                .text(fields.title);
            $header_div.append($icon, $title);
            $header.find('.header-title').empty().append($header_div);
            $header.find('.header-title-button').button();
        }

        var $right_slot = $header.find('.header-right-slot');
        if (fields.hasOwnProperty('right_url')) {
            $right_slot.attr('href', fields.right_url);
            if (fields.hasOwnProperty('right_label')) {
                if (! fields.right_label) {
                    $right_slot.hide(); }
                else {
                    replace_button_text($right_slot, fields.right_label);
                    $right_slot.show(); }}}
        else {
            $right_slot.hide(); }

        var $left_slot = $header.find('.header-left-slot');
        if (fields.hasOwnProperty('left_url')) {
            if (fields.left_url === "-") {
                var parsed = $.mobile.path.parseUrl(window.location.href);
                fields.left_url = parsed.hrefNoHash; }
            $left_slot.attr('href', fields.left_url);
            if (fields.hasOwnProperty('left_label')) {
                if (! fields.left_label) {
                    $left_slot.hide(); }
                else {
                    replace_button_text($left_slot, fields.left_label);
                    $left_slot.show(); }}}
        else {
            $left_slot.hide(); }}

    RootContentNode.prototype.layout_header = function (mode_opts) {
        /* Do special RootContentNode header layout. */
        var fields = ContentNode.prototype.layout_header.call(this, mode_opts);
        // Give the info pages the combo root's depth path menu:
        generic.top_level_info_ids.map(function (id) {
            var alt_mode_opts = {alt_page_selector: '#' + id};
            ContentNode.prototype.layout_header.call(
                this, alt_mode_opts); }.bind(this));

        var $header = this.my_page$().find('[data-role="header"]');
        var $back_button = $header.find('.back-button');
        var $title = $header.find('.header-title');
        $back_button.hide();
        return fields; }

    RecentContentsNode.prototype.layout_header = function (mode_opts) {
        var fields = Node.prototype.layout_header.call(this, mode_opts);
        var $header = this.my_page$().find('[data-role="header"]');
        $header.find('.back-button').hide();
        return fields; }

    FavoriteContentsNode.prototype.layout_header = function (mode_opts) {
        var fields = Node.prototype.layout_header.call(this, mode_opts);
        var $header = this.my_page$().find('[data-role="header"]');
        $header.find('.back-button').hide();
        return fields; }

    RootPanelNode.prototype.layout_header = function (mode_opts) {
        var fields = Node.prototype.layout_header.call(this, mode_opts);
        var $header = this.my_page$().find('[data-role="header"]');
        $header.find('.back-button').hide();
        return fields; }

    StorageNode.prototype.layout_header = function(mode_opts) {
        /* Fill in typical values for header fields of .my_page$().
           Many storage node types will use these values as is, some will
           replace them.
         */
        return ContentNode.prototype.layout_header.call(this, mode_opts); }

    RootStorageNode.prototype.layout_header = function(mode_opts) {
        var fields = StorageNode.prototype.layout_header.call(this, mode_opts);

        var $page = this.my_page$();
        $page.find('.my_shares_root_url')
            .attr('href', '#' + my.my_shares_root_url);
        $page.find('.public_shares_root_url')
            .attr('href', '#' + my.public_shares_root_url);
        var $emptiness_message = $page.find('.emptiness-message');
        (this.subdirs.length === 0
         ? $emptiness_message.show()
         : $emptiness_message.hide());
        return fields; }
    PublicRootShareNode.prototype.layout_header = function(mode_opts) {
        var fields = ShareNode.prototype.layout_header.call(this, mode_opts);

        // Inject a brief description.
        var $page = this.my_page$();
        $page.find('.storage_root_url')
            .attr('href', '#' + my.storage_root_url);
        $page.find('.public_shares_root_url')
            .attr('href', '#' + my.public_shares_root_url);
        var $adjust_spiel = $page.find('.adjust-spiel');
        (this.subdirs.length === 0
         ? $adjust_spiel.hide()
         : $adjust_spiel.show());
        return fields; }
    OriginalRootShareNode.prototype.layout_header = function(mode_opts) {
        var fields = ShareNode.prototype.layout_header.call(this, mode_opts);
        // Adjust the description.
        var $page = this.my_page$();
        var $emptiness_message = $page.find('.emptiness-message');
        $page.find('.storage_root_url').attr('href', '#' + my.storage_root_url);
        $page.find('.public_shares_root_url')
            .attr('href', '#' + my.public_shares_root_url);
        (this.subdirs.length === 0
         ? $emptiness_message.show()
         : $emptiness_message.hide());
        return fields; }

    ShareNode.prototype.layout_header = function(mode_opts) {
        /* Fill in header fields of .my_page$(). */
        var fields = ContentNode.prototype.layout_header.call(this, mode_opts);

        if (this.parent_url) {
            var container = nmgr.get(is_root_url(this.parent_url)
                                     ? ctmgr.get_recent_tab_url(this)
                                     : this.parent_url);
            fields.left_url = '#' + container.url;
            fields.left_label = container.name;
            fields.title = this.title(); }
        else {
            fields.right_url = '#' + add_query_param(this.url, "mode", "edit");
            fields.right_label = "Edit";
            fields.left_url = '#' + add_query_param(this.url, 'mode', "add");
            fields.left_label = "+";
            fields.title = "ShareRooms"; }
        this.layout_header_fields(fields); }

    RootShareNode.prototype.layout_header = function(mode_opts) {
        /* Fill in header fields of .my_page$(). */
        ShareNode.prototype.layout_header.call(this, mode_opts);
        var fields = {'right_url': '#' + add_query_param(this.url,
                                                         "mode", "edit"),
                      'right_label': "Edit"};
        this.layout_header_fields(fields); }

    ContentNode.prototype.layout_content = function (mode_opts,
                                                     subdirs,
                                                     files,
                                                     content_items_selector) {
        /* Present this content node by adjusting its DOM data-role="page".
           'mode_opts' adjust various aspects of provisioning and layout.
           'subdirs' is an optional array of urls for contained directories,
             otherwise this.subdirs is used;
           'files' is an optional array of urls for contained files, otherwise
             this.files is used;
           'content_items_selector' optionally specifies the selector for
             the listview to hold the items, via this.my_content_items$().
         */
        var $page = this.my_page$();
	var $content = $page.find('[data-role="content"]');
	var $list = this.my_content_items$(content_items_selector);
        if ($list.children().length) {
            $list.empty(); }

        subdirs = subdirs || this.subdirs;
        var lensubdirs = subdirs ? subdirs.length : 0;
        files = files || this.files;
        var lenfiles = files ? files.length : 0;
        var do_dividers = ((! (mode_opts && mode_opts.no_dividers))
                           && ((lensubdirs + lenfiles)
                               > generic.dividers_threshold));
        var do_filter = (lensubdirs + lenfiles) > generic.filter_threshold;

        function insert_item($item) {
            if ($cursor === $list) { $cursor.append($item); }
            else { $cursor.after($item); }
            $cursor = $item; }
        function conditionally_insert_divider(t) {
            if (do_dividers && t && (t[0].toUpperCase() !== curinitial)) {
                curinitial = t[0].toUpperCase();
                indicator = curinitial + divider_suffix;
                $item = $('<li data-role="list-divider" id="divider-'
                          + indicator + '">' + indicator + '</li>')
                insert_item($item); }}
        function insert_subnode(suburl) {
            var subnode = node_manager.get(suburl, this);
            conditionally_insert_divider(subnode.name);
            insert_item(subnode.layout_item$(mode_opts)); }

        if (lensubdirs + lenfiles === 0) {
            $list.append($('<li title="Empty" class="empty-placeholder"/>')
                         .html('<span class="empty-sign ui-btn-text">'
                               + '&empty;</span>')); }
        else {
            var $item;
            var curinitial, divider_suffix, indicator = "";
            var $cursor = $list;

            if (do_filter) { $list.attr('data-filter', 'true'); }
            if (lensubdirs) {
                divider_suffix = " /";
                for (var i=0; i < subdirs.length; i++) {
                    insert_subnode(subdirs[i]); }}
            if (lenfiles) {
                divider_suffix = "";
                for (var i=0; i < files.length; i++) {
                    insert_subnode(files[i]); }}}

        $page.page();
        $list.listview("refresh");
        return $page; }

    Node.prototype.layout_item$ = function(mode_opts) {
        /* Return a jQuery object with the basic content item layout. */
        var $anchor = $('<a/>').attr('class', "crushed-vertical item-url");
        var href;
        if (mode_opts
            && mode_opts.hasOwnProperty('refresh')) {
            href = "#" + (add_query_param(this.url,
                                          'refresh', "true", true)); }
        else {
            href = "#" + this.url; }
        $anchor.attr('href', href);
        $anchor.attr('data-transition',
                     (mode_opts && mode_opts.transition) || "slide");
        $anchor.append($('<h4 class="item-title"/>').html(this.name));
        var $icon = this.my_icon_image$("ui-li-icon");
        if ($icon) {
            $anchor.children().before($icon); }

        var $it = $('<li/>').append($anchor);
        $it.attr('data-icon',
                 (mode_opts && mode_opts.icon) || "so-carat-r");

        if (mode_opts
            && mode_opts.hasOwnProperty('actions_menu_link_creator')) {
            $anchor = mode_opts.actions_menu_link_creator(this.url);
            $it.find('a').after($anchor); }

        $it.attr('data-filtertext', this.name);

        return $it; }
    FolderContentNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a jQuery object representing a folder-like content item.

           If mode_opts has 'actions_menu_link_creator', apply it to our
           URL to get back a anchor to a context-specific actions menu for
           this item.
         */
        return ContentNode.prototype.layout_item$.call(this, mode_opts); }
    DeviceStorageNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage device's description as a jQuery item. */
        return FolderStorageNode.prototype.layout_item$.call(this, mode_opts); }
    FolderStorageNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage folder's description as a jQuery item. */
        return FolderContentNode.prototype.layout_item$.call(this, mode_opts); }
    FolderShareNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a share room folder's description as a jQuery item. */
        return FolderContentNode.prototype.layout_item$.call(this, mode_opts); }
    RoomShareNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a share room's description as a jQuery item. */
        var $it = FolderShareNode.prototype.layout_item$.call(this, mode_opts);
        var $title = $it.find('.item-title');
        $title.html($title.html()
                    + '<div> <small> <span class="subdued">Share ID:</span> '
                    + this.share_id
                    + ' </small> </div>');
        return $it; }
    FileContentNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a file-like content node's description as a jQuery item. */
        var $it = ContentNode.prototype.layout_item$.call(this, mode_opts);

        var type = describe_file_by_name(this.name);
        var pretty_type = type ? (type + ", ") : "";
        var $details = $('<p>' + pretty_type + bytesToSize(this.size) +'</p>');

        var date = new Date(this.mtime*1000);
        var day_splat = date.toLocaleDateString().split(",");
        var $date = $('<p class="ul-li-aside">'
                      + day_splat[1] + "," + day_splat[2]
                      + " " + date.toLocaleTimeString()
                      +'</p>');
        var $table = $('<table width="100%"/>');
        var $icon = this.my_icon_image$("so-image-icon");
        var $name = $('<h4/>').html(this.name);
        var $legend = ($('<table/>')
                       .append($('<tr/>')
                               .append($('<td valign="center"/>').append($icon),
                                       $('<td/>').append($name))));
        var $td = $('<td colspan="2"/>').append($legend);
        $table.append($('<tr/>').append($td));
        var $tr = $('<tr/>');
        $tr.append($('<td/>').append($details).attr('wrap', "none"));
        $tr.append($('<td/>').append($date).attr('align', "right"));
        $table.append($tr);

        var $anchor = $it.find('a.item-url');
        $anchor.empty();
        $anchor.append($table);

        return $it; }

    FileStorageNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage file's description as a jQuery item. */
        return FileContentNode.prototype.layout_item$.call(this, mode_opts); }
    FileShareNode.prototype.layout_item$ = function(mode_opts) {
        /* Return a storage file's description as a jQuery item. */
        return FileContentNode.prototype.layout_item$.call(this, mode_opts); }
    RootContentNode.prototype.layout_item$ = function(mode_opts) {
        /* Present the combo root as a jQm listview item.
           Include a logout split-button link. */

        function logout_link_button(url) {
            var logout_link = '#' + add_query_param(this.url,
                                                    'logout', "true");
            return $('<a href="' + logout_link + '" data-icon="delete"'
                     + ' data-role="button" class="logout-button"'
                     + ' data-iconpos="notext"> Logout </a>'); }

        // Duplicate, rather than pollute the circulating mode_opts:
        mode_opts = $.extend({}, mode_opts || {});
        if (this.loggedin_ish()
            && (! mode_opts.hasOwnProperty('actions_menu_link_creator'))) {
            mode_opts.actions_menu_link_creator
                = logout_link_button.bind(this); }
        return FolderContentNode.prototype.layout_item$.call(this, mode_opts); }

    /**
     * Populate the footer navbar according to specifications.
     *
     * Populate the nodes' footer according to a 'spec_array', so that the
     * specific items in the produced footer can subsequently be adjusted
     * by {@link Node#change_footer_item} using selectors.
     *
     * The spec array is sequence of specification objects, one for each of
     * (max, 5) footer tabs:
     *
     * [spec-obj-1, spec-obj-2, ...]
     *
     * Each spec is an object that must have these properties:
     *
     *   title: <the legend for the action>,
     *   url: <the url of the target object>,
     *   selector: <class for the item, for later selection>,
     *   transition: transition effect (optional),
     *   icon_name: <name of the action icon>}
     *
     * The items in the constructed footer will be addressable by the
     * specified class-selector, and also by sequentially numbered
     * selector strings of the form "footer-item-N", where N starts
     * with 1.
     *
     * @see Node#change_footer_item
     * @see Node#layout_footer
     *
     * @this {Node}
     * @param {object} spec_array Footer entries specifications
     * @param {object} mode_opts User settings and operation mode options
     */
    Node.prototype.layout_footer_by_spec = function(spec_array, mode_opts) {
        var $ul = $('<ul/>');
        var element_count = 1;
        var $anchor;
        spec_array.map(function (spec) {
            var $li = $('<li/>');
            var classes = ("footer-item-" + element_count
                           + " " + spec.selector);
            $li.attr('class', classes);
            $anchor = $('<a data-role="button"/>');
            var focus_token = ctmgr.tab_focus_token(spec.url);
            if (focus_token) {
                $anchor.attr('so-tab-focus', focus_token); }
            $anchor.attr('data-icon', spec.icon_name);
            $anchor.attr('data-iconpos', "top");
            $anchor.attr('href', spec.url);
            if (spec.transition) {
                $anchor.attr('data-transition', spec.transition); }
            // Enclose text in a labelled span so we can get at it surgically,
            // from within intervening stuff that jQuery injects:
            $anchor.append($('<span class="item-label"/>')
                           .text(spec.title));
            $li.append($anchor);
            $ul.append($li);
            element_count += 1; });
        var $footer = this.my_page$().find('[data-role="footer"]');
        var $navbar = $footer.find('[data-role="navbar"]');
        $navbar.replaceWith($('<div data-role="navbar"/>').append($ul));
        $navbar = $footer.find('[data-role="navbar"]');
        $navbar.navbar(); }

    /**
     * Alter a footer item identified by 'selector', applying 'spec'.
     *
     * Fields missing from the spec will be left unaltered.  A new selector
     * will be appended (if not already present; the old selector class
     * will be retained). See {@link Node#layout_footer_by_spec} for entry
     * specification details.
     *
     * @see Node#layout_footer_by_spec
     * @see Node#layout_footer
     *
     * @this {Node}
     * @param {string} selector jquery search that locates in the footer navbar
     * @param {object} spec Dictionary specifying footer entry characteristics
     * @param {object} mode_opts User settings and operation mode options
     */
    Node.prototype.change_footer_item = function(selector, spec, mode_opts) {
        var $footer = this.my_page$().find('[data-role="footer"]');
        var $navbar = $footer.find('[data-role="navbar"]');
        var $target_li = $navbar.find(selector);
        if ($target_li.length > 0) {
            if (spec.title) {
                $target_li.find('a span.item-label')
                    .text(spec.title); }
            if (spec.url) {
                $target_li.find('a').attr('href', spec.url); }
            if (spec.selector) {
                // NOTE: We don't remove the prior class
                var classes = $target_li.attr('class');
                if (classes.indexOf(spec.selector) === -1) {
                    $target_li.attr('class',
                                    classes.concat(" "
                                                   + spec.selector)); }}
            if (! is_compact_mode() && spec.icon_name) {
                $target_li.find('a').attr('data-icon', spec.icon_name) }
            $navbar.navbar(); }}

    /**
     * Populate the footer for this node.
     *
     * @this {Node}
     * @param {object} mode_opts User settings and operation mode options
     */
    Node.prototype.layout_footer = function(mode_opts) {
        this.layout_footer_by_spec([{title: "My Stuff",
                                     url: ("#" + generic.combo_root_page_id),
                                     selector: "account",
                                     transition: "fade",
                                     icon_name: "so-account-footer"},
                                    {title: "Shares",
                                     url: ("#" +
                                           generic.published_root_page_id),
                                     selector: "room_public",
                                     transition: "fade",
                                     icon_name: "so-room_public"},
                                    {title: "Favorites",
                                     url: ("#" +
                                           generic.favorites_page_id),
                                     selector: "favorites",
                                     transition: "fade",
                                     icon_name: "so-favorites"},
                                    {title: "Recent",
                                     url: ("#" + generic.recents_page_id),
                                     selector: "recents",
                                     transition: "fade",
                                     icon_name: "so-recents-footer"},
                                    {title: "Settings",
                                     url: ("#" +
                                           generic.panel_root_page_id),
                                     selector: "settings",
                                     transition: "fade",
                                     icon_name: "so-settings"},
                                    ],
                                   mode_opts); }

    /** Return a jquery DOM search for my page, by id. */
    Node.prototype.my_page_from_dom$ = function () {
        return $('#' + fragment_quote(this.my_page_id())); }
    /** Return this panel's jQuery page object.
     */

    PanelNode.prototype.my_page$ = function () {
        return this.$page; }

    ContentNode.prototype.my_page$ = function (reinit) {
        /* Return this node's jQuery page object, producing if not present.

           Optional 'reinit' means to discard existing page, if any,
           forcing clone of a new copy.

           If not present, we get a clone of the storage page template, and
           situate the clone after the storage page template.
        */
        if (reinit && this.$page) {
            this.$page.remove();
            delete this.$page; }
        if (! this.$page) {
            var $template = this.get_page_template$();
            if (! $template) {
                error_alert("Missing markup",
                            "Expected page #"
                            + this.my_page_id()
                            + " not found."); }
            this.$page = $template.clone();
            this.$page.attr('id', this.my_page_id());
            this.$page.attr('data-url', this.my_page_id());
            // Include our page in the DOM, after the storage page template:
            $template.after(this.my_page$()); }
        return this.$page; }
    RootContentNode.prototype.my_page$ = function () {
        /* Return the special case of the root content nodes actual page. */
        return (this.$page
                ? this.$page
                : (this.$page = $("#" + this.my_page_id()))); }
    PublicRootShareNode.prototype.my_page$ = function () {
        return RootContentNode.prototype.my_page$.call(this); }
    OriginalRootShareNode.prototype.my_page$ = function () {
        return RootContentNode.prototype.my_page$.call(this); }
    RootStorageNode.prototype.my_page$ = function () {
        return RootContentNode.prototype.my_page$.call(this); }

    ContentNode.prototype.my_content_items$ = function (selector) {
        /* Return this node's jQuery contents listview object.
           Optional 'selector' is used, otherwise '.content-items'. */
        return this.my_page$().find(selector || '.content-items'); }
    ContentNode.prototype.get_page_template$ = function() {
        return $("#" + generic.content_page_template_id); }

    PanelNode.prototype.get_page_template$ = function() {
        return $("#" + generic.panel_root_page_id); }

    Node.prototype.my_icon_image$ = function(image_class) {
        /* Return this item's icon image element, with 'image_class'.
           Return null if this item has no icon.

           The image has this.emblem as the alternate text.

           Typically, image class is one of "so-image-icon", for images
           situated in arbitrary places, or ui-li-icon for images in jQm
           icon image slots. */
        var icon = this.my_icon_path();
        if (! icon) { return null; }
        return ($('<img/>').attr('src', icon).attr('alt', this.emblem)
                .attr('class', image_class)); }

    FileContentNode.prototype.my_icon_path = function() {
        var icon = icon_name_by_file_name(this.name);
        return generic.icons_dir + "/" + (icon
                                          ?  icon + ".png"
                                          : "file.png"); }
    FileStorageNode.prototype.my_icon_path = function() {
        return FileContentNode.prototype.my_icon_path.call(this); }
    FileShareNode.prototype.my_icon_path = function() {
        return FileContentNode.prototype.my_icon_path.call(this); }
    ContentNode.prototype.my_icon_path = function() {
        return generic.icons_dir + "/folder.png"; }
    PanelNode.prototype.my_icon_path = function() {
        return generic.icons_dir + "/settings.png"; }
    DeviceStorageNode.prototype.my_icon_path = function() {
        return generic.icons_dir + "/device.png"; }
    RoomShareNode.prototype.my_icon_path = function() {
        return generic.icons_dir + "/room_public.png"; }
    OriginalRootShareNode.prototype.my_icon_path = function() {
        return generic.icons_dir + "/room_original.png"; }
    PublicRootShareNode.prototype.my_icon_path = function() {
        return generic.icons_dir + "/room_public.png"; }
    RootContentNode.prototype.my_icon_path = function () {
        return generic.brand_images_dir + "/brand_logo.png"; }

    PanelNode.prototype.my_icon_path = function () {
        return generic.icons_dir + "/settings.png"; }

    Node.prototype.here = function () {
        /* Return the complete address of this content node, as part of the
           application code, not just its JSON url.  */
        return window.location.href.split('#')[0] + '#' + this.url; }

    Node.prototype.title = function () {
        return this.name || (is_compact_mode() ? brand.label : this.emblem); }

    RootContentNode.prototype.title = function () {
        return my.username || (is_compact_mode() ? brand.label : this.emblem); }

    /* ===== Popup Menus ===== */

    Node.prototype.depth_path_menu = function(event) {
        /* Popup a menu showing from the containment navigation with more
           distant further down. Include a link to logout. */

        var $popup = $('#' + generic.depth_path_popup_id);
        var mode_opts = {};

        var $listview = $popup.find('[data-role="listview"]');
        $listview.empty();

        // refresh necessary so jQuery traversal stuff doesn't pass over:
        if (! is_noncontent_node(this)) {
            $listview.append(this.layout_item$($.extend({refresh: true,
                                                         icon: "refresh"},
                                                        mode_opts))); }
        var ancestor_url = this.parent_url;
        while (ancestor_url) {
            var ancestor = node_manager.get(ancestor_url);
            $listview.append(
                ancestor.layout_item$($.extend({transition: "slidedown",
                                                icon: "so-carat-l"},
                                               mode_opts)));
            ancestor_url = ancestor.parent_url; }

        $popup.popup();
        $popup.parent().page();
        $listview.listview('refresh');
        $popup.popup('open', event.clientX, event.clientY);
        // Stop percolation:
        return false; }

    /* ===== Resource managers ===== */

    var persistence_manager = {
        /* Maintain domain-specific persistent settings, using localStorage.
           - Value structure is maintained using JSON.
           - Use .get(name), .set(name, value), and .remove(name).
           - .keys() returns an array of all stored keys.
           - .length returns the number of keys.
         */
        // NOTE Compat: versions of android < 2.1 do not support localStorage.
        //              They do support gears sqlite. lawnchair would make it
        //              easy to switch between them.
        get: function (name) {
            /* Retrieve the value for 'name' from persistent storage. */
            return JSON.parse(localStorage.getItem(name)); },
        set: function (name, value) {
            /* Preserve name and value in persistent storage.
               Return the settings manager, for chaining. */
            localStorage.setItem(name, JSON.stringify(value));
            return persistence_manager; },
        remove: function (name) {
            /* Delete persistent storage of name. */
            localStorage.removeItem(name); },
        keys: function () { return Object.keys(localStorage); },
        };
    Object.defineProperty(persistence_manager, "length",
                          {get: function() {return localStorage.length; },
                           enumerable: true,
                          });
    var pmgr = persistence_manager;            // Compact name.


    var remember_manager = {
        /* Maintain user account info in persistent storage. */

        // "remember_me" field not in fields, so its' setting is retained
        // when remembering is disabled:
        fields: ['username', 'storage_host', 'storage_web_url'],

        unset: function (disposition) {
            /* True if no persistent remember manager settings are found. */
            return persistence_manager.get("remember_me") === null; },
        active: function (disposition) {
            /* Report or set "Remember Me" persistent account info retention.
               'disposition':
                 - activate if truthy,
                 - return status if not passed in, ie undefined,
                 - deactivate otherwise.
               Deactivating entails wiping the retained account info settings.
            */
            if (disposition) {
                return persistence_manager.set("remember_me", true); }
            else if (typeof disposition === "undefined") {
                return persistence_manager.get("remember_me"); }
            else {
                remember_manager.fields.map(function (key) {
                    persistence_manager.remove(key); });
                return persistence_manager.set("remember_me", false); }},

        fetch: function () {
            /* Return remembered account info . */
            var got = {};
            remember_manager.fields.map(function (key) {
                got[key] = persistence_manager.get(key); });
            return got; },

        store: function (obj) {
            /* Preserve account info, obtaining specific fields from 'obj'.
               Error is thrown if obj lacks any fields. */
            remember_manager.fields.map(function (key) {
                if (! obj.hasOwnProperty(key)) {
                    throw new Error("Missing field: " + key); }
                persistence_manager.set(key, obj[key]); })},

        remove_storage_host: function () {
            /* Remove the persisted value for the storage_host.  This is the
               way to inhibit auto-login, without losing the convenience of
               a remembered username (in the absence of a way to remove the
               authentication cookies). */
            persistence_manager.remove('storage_host'); },
    };
    var remgr = remember_manager;

    var transit_manager = function () {
        /* Facilities to detect repeated traversals of the same URL.

           To use, when handling a url that you expect might be spuriously
           repeated (eg by jQm popup dismissal), use instead a treated
           version of the url:

               url = transit_manager.distinguish(url)

           Then, handle_content_visit() will recognize repeats that happen
           within recents_span traversals and let them pass (by using
           transit_manager.is_repeat_url()).
        */
        var tm_param_name = "so_transit";
        var recent_transits = [];
        var recents_span = 3;

        function new_distinction() {
            return ''.concat(new Date().getTime()
                             + Math.floor(Math.random() * 1e5)); }
        function is_repeat(distinction) {
            /* Check 'distinction', and register that we've seen it if not
               already registered. */
            if (! distinction) { return false; }
            else if (recent_transits.indexOf(distinction) != -1) {
                return true; }
            else {
                recent_transits.unshift(distinction);
                recent_transits.splice(recents_span);
                return false; }}

        return {
            distinguish_url: function(url) {
                /* Add a query parameter to a url to distinguish it, so it
                   can be recognized on redundant changePage. */
                var distinct = new_distinction();
                var delim = ((url.search('\\?') === -1) ? "?" : "&");
                return url.concat(delim + tm_param_name + "=" + distinct); },
            is_repeat_url: function(url) {
                return is_repeat(query_params(url)[tm_param_name]); },
        }}()
    var tmgr = transit_manager;


    /**
     * Facilities to correctly maintain current tab focus.
     *
     * This singleton utility manages organization and imposition of
     * information about the app's current tab focus.
     *
     * @this {function}
     */
    var current_tab_manager = function () {
        /* Private */

        /** Object currently occupying the tab-bar */
        var current_tab_url = null;
        /** Class selector for the tab to be highlighted */
        var tab_class = 'so-selected-tab';

        /* Public */

        return {
            /** Assign the current tab according to the specified node.
             *
             * For root nodes, just assign and go on.
             *
             * We need to do some work when a visit is initiated of share
             * room content from a non-content tab, because share rooms can
             * simultaneously reside among both the account resources
             * (orignal shares) and the list of currently visited published
             * shares.
             *
             * @param {node} the node by which we determine the current tab
             */
            set_current_from: function (node) {
                var next_current = ctmgr.get_recent_tab_url(node);
                if (current_tab_url !== next_current) {
                    current_tab_manager.focus(next_current); }
                if ((node.recent_tab_url !== next_current)
                    && (! is_noncontent_node(nmgr.get(next_current)))) {
                    node.recent_tab_url = next_current; }
            },
            /** Identify the current tab according to the specified node.
             *
             * @see spideroak.current_tab_manager#set_current_from.
             *
             * @param {node} the node by which we determine the current tab
             */
            get_recent_tab_url: function (node) {
                var url = node.url;
                if (is_root_url(url)) {
                    // Explicitly visiting a tab
                    return url; }
                else {
                    if (! is_noncontent_node(nmgr.get(current_tab_url))) {
                        return current_tab_url; }
                    else if (node.recent_tab_url) {
                        return node.recent_tab_url; }
                    else {
                        // Curent node isn't a content root, and it has no
                        // registered recent tab, so infer one:
                        // - Use published shares, if its included there
                        // - Use account's shares, if its included there
                        // - Otherwise, leave the current setting.
                        var container = node.outer_container();
                        var published = node_manager.get_published();
                        var myshares = node_manager.get_myshares();
                        if (published.contains(container)) {
                            return container.url; }
                        else if (myshares.contains(container)) {
                            return myshares.url; }
                        else {
                            // This can happen, eg if the containing room
                            // was dropped, but the node is still in favorites.
                            blather('No recent or container tab for: "'
                                    + node.name + '" - ' + node.url);
                            return current_tab_url; }
                    }
                }
            },
            /** If url is of tab under focus, return a token to distinguish it.
             *
             * Otherwise, return false.
             *
             * @param {string} tab_url Url of the tab's object to be evaluated
             */
            tab_focus_token: function (tab_url) {
                if (url_tail(tab_url) === url_tail(current_tab_url)) {
                    return tab_class; }
                else { return false; }
            },
            /** Register specified tab url as the current focus.
             *
             * @param {string} tab_url Url to register.
             */
            focus: function (tab_url) {
                current_tab_url = tab_url;
            },
            cturl: (SO_DEBUGGING
                    ? function () { return current_tab_url;}
                    : null),
        }
    }();
    var ctmgr = current_tab_manager; // Compact name, for convenience.


    /** Register and implement methods to effect user-controlled settings.
     *
     * Settings are primed from the user_settings variable, to designate
     * security mode and default values, for those that need it. Those not
     * explicitly defined get literal (not secure) mode and empty-string
     * default value.
     *
     * Settings values can have "pretty" values associated with them, for
     * presentation of aliases in the UI. (Eg, "Immediate" for timeout
     * value = 0 seconds, etc.)
     *
     * Because one of our key/value storage mechanisms (the secure
     * keychain) uses callbacks to convey results, our value setting and
     * getting procedures return deferred object promises. To use them, the
     * receiver registers'done' and 'fail' callbacks to get the results when
     * the deferred objects business is concluded. This is so even for simple
     * local-storage based mechanisms, for consistency.
     * So get used to it. (-%
     */
    var settings_manager = function () {
        /* Private */

        /** Map names to their most recently obtained value.
         *
         * @private
         */
        var immediate_by_name = {};

        /** Registry of getsetter methods per settings name.
         *
         * Map names to a string identifying the type of getsetter method
         * (see below) to use for setting and getting the value.
         *
         * @private
         */
        var getsetter_by_name = {};
        /** Retrieve the getsetter method for given name.
         *
         * We do proper defaulting, according to the spec for the null entry.
         *
         * @return {function}
         */
        function get_getsetter(name) {
            return getsetters[getsetter_by_name[name]
                              || getsetter_by_name[null]]; }

        /** Registry of  methods per settings name.
         *
         * Map setting name and value to a pretty version of the value.
         * The lookups are nested, with name mapping to an object that maps
         * val to pretty val.
         *
         * @private
         */
        var pretty_by_name_and_val = {};
        /** Retrieve the pretty value for given name.
         *
         * We do proper defaulting, according to the spec for the null entry.
         *
         * @return {function}
         */
        function get_getsetter(name) {
            return getsetters[getsetter_by_name[name]
                              || getsetter_by_name[null]]; }

        /** Settings set and get methods.  Add new ones here.
         *
         * Each method should return a deferred object promise, which will take
         * 'done' and 'fail' callbacks to convey:
         * - the value via 'done' callback from a successful .get,
         *   or the error message via 'fail' callbacks.
         * - true via 'done' from a successful .set, or the error via 'fail'.
         *
         * (The deferred approach is necessary for, eg, the secure get/set
         * mechanism, and we're using it for all for consistency.)
         *
         * One duty of any getter is to assign immediate_by_name[name] to
         * the obtained value, when successfully obtained.
         *
         * @private
         */
        var getsetters = {
            /** Store values using persistence_manager / local.
             *
             * @return {object} Promise, already resolved.
             */
            literal: function (name, value) {
                var deferred = new jQuery.Deferred();
                if (typeof value === "undefined") {
                    deferred.done(function (got_val)
                                  { immediate_by_name[name] = got_val;
                                    return got_val; });
                    deferred.resolve(persistence_manager.get(name));
                } else {
                    persistence_manager.set(name, value);
                    deferred.resolve(true);
                }
                return deferred.promise();
            },
            /** Store values using secure storage.
             *
             * Our promise actually concludes asynchronously.
             *
             * @private
             * @return {object} Promise to deliver keychain result
             */
            secure: function (name, value) {
                var kc = get_keychain();
                var deferred = new jQuery.Deferred();
                if (typeof value === "undefined") {
                    deferred.done(function (got_val)
                                  { immediate_by_name[name] = got_val;
                                    return got_val; });
                    kc.getForKey(deferred.resolve, deferred.reject,
                                 name, generic.keychain_servicename);
                } else {
                    kc.setForKey(deferred.resolve, deferred.reject,
                                 name, value, generic.keychain_servicename);
                }
                return deferred.promise();
            },
        } /* getsetters */

        /** Associate a pretty value for value of settings name.
         *
         * By associating the pretty value with the specific setting's
         * value, the pretty value can be obtained as an adjunct of the
         * current value, whatever the current value happens to be.
         *
         * The most recently asserted association for a setting value prevails.
         *
         * @private
         * @param {string} name Settings variable name
         * @param {string} value Value for which we want a pretty value
         * @param {string} pretty_val Version of value for display on forms
         */
        function assoc_pretty_val(name, value, pretty_value) {
            var for_name = pretty_by_name_and_val[name] || {};
            for_name[value] = pretty_value;
        }

        return {
            /** Associate settings var with its getter and setter methods.
             *
             * The setting/getting method is the name of one of those in
             * the get_setters object.  initial_val is an initial value to
             * assign.  pretty_val is a presentable version of this value.
             *
             * When we have an initial_val, we do a '.get()' immediately so
             * successful assignment will be seen ASAP by
             * '.get_immediate()'.
             *
             * @public
             * @param {string} name Variable name
             * @param {string} getsetter_id Name of getsetter method
             * @param {string} initial_val Default value
             * @param {string} pretty_val Version of value for display on forms
             */
            define: function(name, getsetter_id, initial_val, pretty_val) {
                // "default" is a reserved word, hence "initial_val".
                getsetter_by_name[name] = getsetter_id;
                assoc_pretty_val(name, initial_val, pretty_val);
                if (typeof initial_val !== "undefined") {
                    settings_manager.set(name, initial_val);
                    // Do an intial .get so immediate_by_name is primed:
                    settings_manager.get(name); }
            },
            /** Set using the designated setter.
             *
             * @return {object} promise A deferred object promise for the status
             * @public
             * @param {string} name Settings variable name
             * @param {string} value The value to assign to the named variable.
             * @param {string} pretty_val Version of value for display on forms
             */
            set: function(name, value, pretty_val) {
                assoc_pretty_val(name, value, pretty_val);
                var method = get_getsetter(name);
                return method(name, value);
            },
            /** Get a settings value, using its getter.
             *
             * @return {object} promise A deferred object promise for the result
             * @public
             * @param {string} name Settings variable name
             */
            get: function(name) {
                var method = get_getsetter(name);
                return method(name);
            },
            /** Get the most recently obtained value for a setting.
             *
             * This will miss values that are asynchronously pending.  Use
             * the promise object returned from a plain '.get' to ensure
             * catching those.
             *
             * @return {string} value The most recently gotten value.
             * @public
             * @param {string} name Settings variable name
             */
            get_immediate: function(name) {
                return immediate_by_name[name];
            },
            /** Get the pretty name for a settings value.
             *
             * @return {object} A string or <undefined> for absent pretty value.
             * @public
             * @param {string} name Settings variable name
             * @param {string} value Value for which we want a pretty value
             */
            get_pretty: function(name, value) {
                var name_values = pretty_by_name_and_val[name];
                return name_values && name_values[value];
            },
            /** Establish default settings.
             *
             */
            init: function() {
                user_settings.map(
                    function (entry) {
                        var name = entry[0],
                        getset = entry[1],
                        the_default = entry[2],
                        pretty = entry[3];
                        settings_manager.define(name, getset,
                                                the_default, pretty); });
            },
        } /* return {} */
    }()
    var setmgr = settings_manager; // Compact name, for convenience.

    /** Retrieve the collection of pages with so-page-category=category.
     *
     * @param {string} category As assigned to the so-page-catgory tag attribute
     */
    function get_pages_by_category$(category) {
        return $('[so-page-category="' + category + '"]');
    }

    /** Produce, provide access to, and dispose of item nodes.
     *
     * This singleton utility manages items including content, content
     * containers, and other (like settings) nodes.  The '.get' routine is
     * the primary interface, and either finds existing nodes matching the
     * criteria, or creates them if not already present.  The type of newly
     * minted nodes is determined according to get parameters.
     *
     * @this {function}
     */
    var node_manager = function () {
        // ???: More compact operation: Remove nodes when ascending above them?
        // ???: Optimzations:
        // - prefetch offspring layer and defer release til 2 layers above.
        // - make fetch of multiple items contingent to device lastcommit time.

        /* Private */
        var by_url = {};

        // Cached references, for frequent access with impunity:
        var combo_root = null;
        var myshares = null;
        var published = null;
        var recents = null;
        var favorites = null;
        var settings = null;


        /* Public */
        return {
            get_combo_root: function () {
                if (! combo_root) {
                    combo_root = this.get(id2url(generic.combo_root_page_id),
                                          null); }
                return combo_root; },

            get_myshares: function () {
                if (! myshares) {
                    myshares = this.get(id2url(generic.my_shares_root_page_id),
                                        null); }
                return myshares; },

            get_published: function () {
                if (! published) {
                    published = this.get(id2url(generic.published_root_page_id),
                                         null); }
                return published; },

            get_recents: function () {
                if (! recents) {
                    recents = this.get(id2url(generic.recents_page_id),
                                       this.get_combo_root()); }
                return recents; },

            get_favorites: function () {
                if (! favorites) {
                    favorites = this.get(id2url(generic.favorites_page_id),
                                         this.get_combo_root()); }
                return favorites; },

            get_settings: function () {
                if (! settings) {
                    settings = this.get(id2url(generic.panel_root_page_id),
                                        this.get_combo_root()); }
                return favorites; },

            /** Retrieve a node according to 'url'.
             *
             * New nodes are produced on first reference.  No item provisioning
             * happens here.
             *
             # @param {url} target node address
             * @param {parent} is required for production of new nodes
             */
            get: function (url, parent) {
                url = url.split('?')[0];             // Strip query string.
                var got = by_url[url];
                if (! got) {

                    // Roots:
                    if (is_root_url(url)) {
                        if (is_combo_root_url(url)) {
                            got = new RootContentNode(url, parent); }
                        else if (is_recents_url(url)) {
                            got = new RecentContentsNode(url, parent); }
                        else if (is_favorites_url(url)) {
                            got = new FavoriteContentsNode(url, parent); }
                        else if (is_panel_root_url(url)) {
                            got = new RootPanelNode(url, parent); }
                        else if (url === my.storage_root_url) {
                            got = new RootStorageNode(url, parent); }
                        else if (url === my.my_shares_root_url) {
                            got = new OriginalRootShareNode(url, parent); }
                        else if (url === my.public_shares_root_url) {
                            got = new PublicRootShareNode(url, parent); }
                        else if (url ===
                                 id2url(generic.published_root_page_id)) {
                            got = new PublicRootShareNode(url, parent); }
                        else {
                            throw new Error("Content model management error");}}

                    // Panels:
                    else if (is_panel_url(url)) {
                        got = new PanelNode(url, parent); }

                    // Contents:
                    else if (parent && (is_root_url(parent.url))) {
                        // Content node just below a root:
                        if (is_storage_url(url)) {
                            got = new DeviceStorageNode(url, parent); }
                        else {
                            got = new RoomShareNode(url, parent); }}
                    else if (url.charAt(url.length-1) !== "/") {
                        // No trailing slash.
                        if (is_storage_url(url)) {
                            got = new FileStorageNode(url, parent); }
                        else {
                            got = new FileShareNode(url, parent); }}
                    else {
                        if (is_storage_url(url)) {
                            got = new FolderStorageNode(url, parent); }
                        else {
                            got = new FolderShareNode(url, parent); }
                    }
                    by_url[url] = got;
                }
                return got; },

            free: function (node) {
                /* Remove a content node from index and free it for gc. */
                if (combo_root && (node.url === combo_root.url)) {
                    combo_root = null; }
                else if (recents && node.url === recents.url) {
                    recents = null; }
                if (by_url.hasOwnProperty(node.url)) {
                    delete by_url[node.url]; }
                node.free(); },

            clear_hierarchy: function (url) {
                /* Free node at 'url' and its recursively contained nodes. */
                var it = this.get(url);
                var suburls = it.contained_urls();
                for (var i=0; i < suburls.length; i++) {
                    this.clear_hierarchy(suburls[i]); }
                this.free(it); },

            // Expose the by_url registry when debugging:
            bu: (SO_DEBUGGING ? by_url : null),
        }
    }()
    var nmgr = node_manager; // Compact name, for convenience.


    /* ==== Login / Logout ==== */

    function go_to_entrance() {
        /* Visit the entrance page. Depending on session state, it might
           present a login challenge or it might present the top-level
           contents associated with the logged-in account. */
        // Use a string url so our transit machinery registers a visit.
        $.mobile.changePage(my.combo_root_url); }

    function storage_login(login_info, url) {
        /* Login to storage account and commence browsing at devices.
           'login_info': An object with "username" and "password" attrs.
           'url': An optional url, else generic.storage_login_path is used.
           We provide for redirection to specific alternative servers
           by recursive calls. See:
           https://spideroak.com/apis/partners/web_storage_api#Loggingin
        */
        var login_url;
        var server_host_url;
        var parsed;

        if (url
            && (parsed = $.mobile.path.parseUrl(url))
            && ["http:", "https:"].indexOf(parsed.protocol) !== -1) {
            server_host_url = parsed.domain;
            login_url = url; }

        else {
            server_host_url = generic.base_host_url;
            login_url = (server_host_url + generic.storage_login_path); }

        $.ajax({
            url: login_url,
            type: 'POST',
            dataType: 'text',
            data: login_info,
            success: function (data) {
                var match = data.match(/^(login|location):(.+)$/m);
                if (!match) {
                    var combo_root = node_manager.get_combo_root();
                    combo_root.show_status_message(
                        error_alert_message(_t('Temporary server failure'),
                                            _t('Please try again later.'))); }
                else if (match[1] === 'login') {
                    if (match[2].charAt(0) === "/") {
                        login_url = server_host_url + match[2]; }
                    else if (generic.debug_proxying) {
                        var ahr = generic.alt_host_replace;
                        if (match[2].slice(0, ahr.length) === ahr) {
                            // Use the proxy location:
                            login_url = (generic.alt_host_url
                                         + match[2].slice(ahr.length)); }}
                    else {
                        login_url = match[2]; }
                    storage_login(login_info, login_url); }
                else {
                    // Browser haz auth cookies, we haz relative location.
                    storage_session_embark(login_info['username'],
                                           server_host_url,
                                           match[2]); }
            },

            error: function (xhr) {
                $.mobile.loading('hide');
                var username;
                if (remember_manager.active()
                    && (username = persistence_manager.get('username'))) {
                    $('#my_login_username').val(username); }
                    var combo_root = node_manager.get_combo_root();
                combo_root.show_status_message(
                    error_alert_message('Storage login', xhr.status));
                $(document).trigger("error"); }
        }); }

    function storage_logout() {
        /* Conclude storage login, clearing credentials and stored data.
           Wind up back on the main entry page. */

        // NOTE: For now we logout only via the combo root.  We're hitting
        // an incompabibility with the default jQm traversal machinery if
        // we try to logout directly from a content page or root, with the
        // machinery apparently expecting some data registered for the
        // fromPage that's not present.

        var combo_root = node_manager.get_combo_root();
        combo_root.logout(); }

    RootContentNode.prototype.logout = function () {
        function finish () {
            clear_storage_account();
            if (remember_manager.active()) {
                // The storage server doesn't remove cookies, so we inhibit
                // relogin by removing the persistent info about the
                // storage host. This leaves the username intact as a
                // "remember" convenience for the user.
                remember_manager.remove_storage_host(); }
            node_manager.get_combo_root().visit({}, {}); }

        if (! this.loggedin_ish()) {
            // Can't reach logout location without server - just clear and bail.
            finish(); }
        else {
            $.ajax({url: my.storage_root_url + generic.storage_logout_suffix,
                    type: 'GET',
                    success: function (data) {
                        finish(); },
                    error: function (xhr) {
                        console.log("Logout ajax fault: "
                                    + xhr.status
                                    + " (" + xhr.statusText + ")");
                        finish(); }}); }}

    function prep_credentials_form(content_selector, submit_handler, name_field,
                                   do_fade) {
        // XXX This needs to be significantly refactored, to be
        //     content-node (RootContentNode versus PublicRootShareNode)
        //     specific, with some share faculties.

        /* Instrument form within 'content_selector' to submit with
           'submit_handler'. 'name_field' is the id of the form field with
           the login name, "password" is assumed to be the password field
           id. If 'do_fade' is true, the content portion of the page will
           be rigged to fade on form submit, and on pagechange reappear
           gradually.  In any case, the password value will be cleared, so
           it can't be reused.
        */
        var $content = $(content_selector);
        var $form = $(content_selector + " form");
        var page_id = $content.closest('[data-role="page"]').attr('id');

        var $password = $form.find('input[name=password]');
        var $name = $form.find('input[name=' + name_field + ']');

        var $submit = $form.find('[type="submit"]');
        var sentinel = new submit_button_sentinel([$name, $password], $submit)
        bind_replace($name, 'input.SpiderOak', sentinel);
        bind_replace($password, 'input.SpiderOak', sentinel);
        bind_replace($(document), 'pagebeforechange.SpiderOak',
                     function (e) {
                         if ($.mobile.activePage
                             && ($.mobile.activePage.attr('id') === page_id)) {
                             $password.val(""); }});
        $submit.button()
        sentinel();

        var $remember_widget = $form.find('.remember');
        var remembering = remember_manager.active();
        if ($remember_widget.attr('id') === "remember-me") {
            if ((remembering || remembering === null)
                && ($remember_widget.val() !== "on")) {
                $remember_widget.val("on");
                // I believe why we need to also .change() is because the
                // presented slider is just tracking the actual select widget.
                $remember_widget.trigger('change'); }
            else if (!remember_manager.unset() && !remembering) {
                $remember_widget.val("off");
                $remember_widget.trigger('change'); }}
        else if ($remember_widget.attr('id') === "retain-visit") {
            var retaining = persistence_manager.get('retaining_visits');
            if ((retaining || (retaining === null))
                 && ($remember_widget.val() !== "on")) {
                $remember_widget.find('option[value="on"]').attr('selected',
                                                                 'selected');
                $remember_widget.val("on");
                $remember_widget.trigger('change'); }
            else if (!retaining && ($remember_widget.val() !== "off")) {
                $remember_widget.val("off");
                $remember_widget.trigger('change'); }}
        else {
            console.error("prep_credentials_form() - Unanticipated form"); }

        var name_field_val = pmgr.get(name_field);
        if (name_field_val
            && ($remember_widget.attr('id') === "remember-me")
            && ($remember_widget.val() === "on")) {
            $name.attr('value',name_field_val); }

        $form.submit(function () {
            $submit.button('disable');
            var $remember_widget = $form.find('.remember');
            var $name = $('input[name=' + name_field + ']', this);
            var $password = $('input[name=password]', this);
            var data = {};
            if (($name.val() === "") || ($password.val() === "")) {
                // Minimal - the submit button sentinel should prevent this.
                return false; }
            data[name_field] = $name.val();
            var remember_widget_on = $remember_widget.val() === "on"
            if ($remember_widget.attr('id') === "remember-me") {
                remember_manager.active(remember_widget_on); }
            else if ($remember_widget.attr('id') === "retain-visit") {
                persistence_manager.set('retaining_visits',
                                        remember_widget_on); }
            else {
                console.error("prep_credentials_form()"
                              + " - Unanticipated form"); }

            data['password'] = $password.val();
            if (do_fade) {
                var combo_root = node_manager.get_combo_root();
                var unhide_form_oneshot = function(event, data) {
                    $.mobile.loading('hide');
                    $(document).unbind("pagechange.SpiderOak",
                                       unhide_form_oneshot);
                    $(document).unbind("error.SpiderOak",
                                       unhide_form_oneshot); }
                bind_replace($(document), "pagechange.SpiderOak",
                             unhide_form_oneshot)
                bind_replace($(document), "error.SpiderOak",
                             unhide_form_oneshot); }
            $name.val("");
            $password.val("");
            $name.focus();
            submit_handler(data);
            return false; }); }

    function prep_html_branding() {
        /* Do brand substitutions in application HTML text. */
        $('.brand-title').text(brand.title);
        $('.brand-label').text(brand.label);
        $('.brand-service_support_link')
            .replaceWith(brand.service_support_link);
        $('.brand-service_home_link')
            .replaceWith(brand.service_home_link);
        }

    function establish_operation_handlers() {
        /* Add handlers for cordova operational events. */
        // See http://docs.phonegap.com/en/2.0.0/cordova_events_events.md.html
        // for special iOS quirks, eg 'active' and 'resign'.
        function addEventListener_single(event, func, useCapture) {
            document.removeEventListener(event, func, useCapture);
            document.addEventListener(event, func, useCapture); }
        addEventListener_single("pause", spideroak_pause, false);
        addEventListener_single("resume", spideroak_resume, false);
        addEventListener_single("online", spideroak_online, false);
        addEventListener_single("offline", spideroak_offline, false);
        addEventListener_single("backbutton", spideroak_backbutton, false);
        // Other events:
        // batterycritical, batterylow, batterystatus, menubutton, searchbutton
        // startcallbutton, endcallbutton, volumedownbutton, volumeupbutton
    }
    var spideroak_pause = function () {
        /* Handle the Cordova "pause" event. */
        console.log("spideroak_pause fired"); }
    var spideroak_resume = function () {
        /* Handle the Cordova "resume" event. */
        console.log("spideroak_resume fired");
        // For those times when the splash screen has gotten stuck "on":
        navigator.splashscreen.hide(); }
    var spideroak_offline = function () {
        /* Handle the Cordova "offline" event. */
        console.log("spideroak_offline fired"); }
    var spideroak_online = function () {
        /* Handle the Cordova "online" event. */
        console.log("spideroak_online fired"); }
    var spideroak_backbutton = function () {
        /* Handle the Cordova "backbutton" event. */
        console.log("spideroak_backbutton fired"); }

    /** Fundamental application initialization.
     *
     * The DOM is ready, populate the root content nodes and panel.
     */
    var spideroak_init = function () {
        /* Do preliminary setup and launch into the combo root. */

        if (window.location.hash) {
            // If we're initting with a hash fragment, discard the fragment
            // so we start from the root node:
            $.mobile.changePage(window.location.href.split('#')[0]); }

        // Setup traversal hook:
        establish_traversal_handler();
        establish_operation_handlers();
        settings_manager.init();

        my.combo_root_url = id2url(generic.combo_root_page_id);
        var combo_root = node_manager.get_combo_root();
        var recents = node_manager.get_recents();
        var public_shares = node_manager.get(my.public_shares_root_url,
                                             combo_root);
        get_pages_by_category$("panel").each(
            function() {
                generic.panels_by_url[id2url(this.id)] = $(this); });
        // Do HTML code brand substitutions:
        prep_html_branding();

        // Properly furnish login form:
        prep_credentials_form('.nav-login-storage', storage_login,
                              'username', true);
        prep_credentials_form('.nav-visit-share',
                              public_shares.add_item_external.bind(
                                  public_shares),
                              'shareid', false);

        // Try a storage account if available from persistent settings
        if (remember_manager.active()) {
            var settings = remember_manager.fetch();
            if (settings.username && settings.storage_host) {
                set_storage_account(settings.username,
                                    settings.storage_host,
                                    settings.storage_web_url); }}

        // ... and go, using the traversal hook:
        $.mobile.changePage(combo_root.url); }


    /* ==== Public interface ==== */

    // ("public_interface" because "public" is reserved in strict mode.)
    var public_interface = {
        init: function () {
            /* Do preliminary setup and launch into the combo root. */
            spideroak_init();
        },
    }


    /* ==== Boilerplate/Utility ==== */

    ContentNode.prototype.show_status_message = function (html, kind) {
        /* Inject 'html' into the page DOM as a status message. Optional
           'kind' is the status message kind - currently, 'result' and
           'error' have distinct color styles, the default is 'error'.
           Returns a produced $status_message object. */
        kind = kind || 'error';
        var selector = '.' + kind + '-status-message';

        var $page = this.my_page$();
        var $sm = $page.find(selector)
        if ($sm.length > 0) {
            $sm.html(html);
            $sm.listview(); }
        else {
            var $li = $('<li class="status-message crushed-vertical '
                        + kind + '-status-message">');
            $li.html(html);
            $sm = $('<ul data-role="listview" data-theme="c"/>');
            $sm.append($li);
            $page.find('[data-role="header"]').after($sm);
            $sm.listview();
            $sm.show(); }
        return $sm; }

    ContentNode.prototype.remove_status_message = function (kind) {
        /* Remove existing status message of specified 'kind' (default,
           all), if present. */
        var selector = (kind
                        ? '.' + kind + '-status-message'
                        : '.status-message');
        var $page = this.my_page$();
        var $sm = $page.find(selector);

        if ($sm.length !== 0) {
            $sm.remove(); }}

    ContentNode.prototype.toString = function () {
        return "<" + this.emblem + ": " + this.url + ">"; }

    function elide_per(text) {
        /* Return text elided to length depending on compact mode. */
        return elide(text, (is_compact_mode()
                            ? generic.compact_title_chars
                            : generic.expansive_title_chars)); }

    /** Map document fragment addresses to methods.
     *
     */
    var method_addresses = {
        logout: storage_logout,
        noop: function () {
            console.log("no-op"); },
    }

    /**
     * Return true if object is one of the content type rosters.
     *
     * Content type rosters are content-like objects used only to list
     * actual content objects.
     *
     * @param {object} obj The object being evaluated.
     */
    function is_noncontent_node(obj) {
        return ((obj instanceof RecentContentsNode)
                || (obj instanceof FavoriteContentsNode)
                || (obj instanceof PanelNode)); }

    /** Return the "internal" version of the 'url'.
     *
     * - For non-string objects, returns the object
     * - For fragments of the application code's url, returns the fragment
     *   (sans the '#'),
     * - Translates page-ids for root content nodes to their urls,
     * - Those last two, combined, transforms fragment references to root
     *   content pages to the urls of those pages.
     * If none of the conditions holds, the original object is returned.
     *
     * @param {object} subject
     */
    function id2url(subject) {
        if (typeof subject !== "string") { return subject; }
        if (subject.split('#')[0] === window.location.href.split('#')[0]) {
            subject = subject.split('#')[1]; }
        switch (subject) {
        case (generic.combo_root_page_id):
        case (generic.recents_page_id):
        case (generic.my_shares_root_page_id):
        case (generic.published_root_page_id):
        case (generic.favorites_page_id):
        case (generic.panel_root_page_id):
        case (generic.published_root_page_id):
            return "https://" + subject;
        case (generic.storage_root_page_id):
            return my.storage_root_url;
        default: return subject; }}

    function content_nodes_by_url_sorter(prev, next) {
        var prev_str = prev, next_str = next;
        var prev_name = node_manager.get(prev).name;
        var next_name = node_manager.get(next).name;
        if (prev_name && next_name) {
            prev_str = prev_name, next_str = next_name; }
        if (prev_str < next_str) { return -1; }
        else if (prev_str > next_str) { return 1; }
        else { return 0; }}

    function is_compact_mode() {
        return $(document).width() < generic.compact_width_threshold; }

    if (SO_DEBUGGING) {
        // Expose the managers for access while debugging:
        public_interface.nmgr = nmgr;
        public_interface.ctmgr = ctmgr;
        public_interface.setmgr = setmgr;
        public_interface.pmgr = pmgr; }

    /* ==== Here we go: ==== */
    return public_interface;
}();

// Report that the app is ready:
so_init_manager.ready('app');

//Local variables:
//js-indent-level: 4
//End:
