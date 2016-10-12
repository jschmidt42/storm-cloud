$(document).ready(function() {
    "use strict";

    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) {
            return typeof args[number] !== 'undefined' ? args[number] : match;
        });
    };

    var itemTemplate = $("#itemTemplate").html();
    var itemUpload = {
        "title": "Add application",
        "description": "Upload a Stingray application package (.zip)",
        "path": "chooseFile()",
        "thumbnail": "img/storm-cloud-add.png"
    };
    var defaultThumbnail = "img/storm-cloud-game.png";
    var dragCounter = 0;
    var dragfile = "";

    function fill(initial) {
        var jItem;

        if (initial) {
            jItem = $(itemTemplate.format(
                itemUpload.title,
                itemUpload.description,
                itemUpload.thumbnail,
                itemUpload.path,
                '<div class="progress-container"><progress class="progress"></progress></div>',
                "upload-tile",
                "upload-item"));
            if (window.FileReader) {

                jItem.on('dragenter', function (e) {
                    if (willHandleDrop(e)) {
                        dragCounter++;
                        highlight(true, $(e.currentTarget));
                    }
                });

                jItem.on('dragleave', function (e) {
                    if (willHandleDrop(e)) {
                        dragCounter--;
                        if (dragCounter === 0) {
                            highlight(false, $(e.currentTarget));
                        }
                    }
                });

                jItem.on('dragover', function (e) {
                    if (willHandleDrop(e)) {
                        e.preventDefault();
                        return false;
                    }

                    return true;
                });

                jItem.on("drop", function (e) {
                    if (willHandleDrop(e)) {
                        if (e.originalEvent.dataTransfer.files[0].name.slice(-3) === "zip") {
                            dragCounter = 0;
                            var formData = new FormData($('form')[0]);
                            formData.append('file', e.originalEvent.dataTransfer.files[0]);
                            upload(formData);
                        }

                        e.preventDefault();
                        highlight(false, $(e.currentTarget));
                    }
                });
            }
            $("#itemsContainer").append(jItem);
        }

        $(".tile").remove();


        $.getJSON("/apps", function(data) {

            var itemsCount = data.length + $("#itemsContainer").children().length;

            if (itemsCount >= 24) {
                $(".storm").addClass("storm24");
            }
            else if (itemsCount >= 15) {
                $(".storm").addClass("storm15");
            }
            else if (itemsCount >= 8) {
                $(".storm").addClass("storm8");
            }
            else if (itemsCount >= 4) {
                $(".storm").addClass("storm4");
            }

            $.each( data, function( index, item ) {
                var link;
                if (item.type === "webgl2") {
                    link = "goto('/packages/" + item.path + "/" + item.indexFile + "')";
                } else {
                    link = "goto('/game.html?path=" + item.path + "')";
                }
                jItem= $(itemTemplate.format(item.title, item.description, item.thumbnail || defaultThumbnail, link, "", "tile"));
                $("#itemsContainer").append(jItem);
            });
        });

        window.setTimeout(fadeInItems, 400);
    }

    function willHandleDrop() {
        return true;
    }

    function highlight(show, el) {
        if (show) {
            el.addClass('drop-hover');
        } else {
            el.removeClass('drop-hover');
        }
    }

    var animTime = 500;
    function fadeInItems() {
        var tiles = $(".tile, .upload-tile").toArray();
        animTime = Math.max(animTime / tiles.length, 50);
        showItem(tiles);
    }

    function showItem(tiles) {
        $(tiles.splice(Math.floor(Math.random()*tiles.length),1)).fadeTo(animTime, 1, function () {
            showItem(tiles);
        });
    }

    function chooseFile() {
        $("#file").click();
    }

    function onFileUploadChange() {
        var formData = new FormData($('form')[0]);
        upload(formData);
    }

    function progressHandlingFunction(e){
        if (e.lengthComputable){
            var progress = $('.progress');
            progress.show();
            progress.attr({
                value: e.loaded,
                max: e.total
            });

            var uploadElement = $("#upload-item .li-name");
            uploadElement.html("Uploading..." + Math.round(e.loaded/e.total*100) + "%");

            if (e.loaded === e.total) {
                uploadElement.html("Validating...");
            }
        }
    }

    function upload(formData) {
        $(".progress-container").slideToggle();
        var uploadElement = $("#upload-item .li-name");
        uploadElement.html("Uploading...");
        $.ajax({
            url: '/upload',  //Server script to process data
            type: 'POST',
            xhr: function() {  // Custom XMLHttpRequest
                var myXhr = $.ajaxSettings.xhr();
                if(myXhr.upload){ // Check if upload property exists
                    myXhr.upload.addEventListener('progress', progressHandlingFunction, false); // For handling the progress of the upload
                }
                return myXhr;
            },
            //Ajax events
            //beforeSend: beforeSendHandler,
            success: function () {
                fill(false);
                uploadElement.html("<font color=green>Uploaded!</font>");
                setTimeout(function () {
                    $(".progress-container").slideToggle();
                    uploadElement.html("Add Application");
                }, 3000);
            },
            error: function (err) {
                uploadElement.html("<font color=red>Failed</font>");
                alert('Failed to upload package.\n' + err.responseText);
                setTimeout(function () {
                    $('.progress').hide();
                    uploadElement.html("Add Application");
                }, 2000);
            },
            // Form data
            data: formData,
            //Options to tell jQuery not to process data or worry about content-type.
            cache: false,
            contentType: false,
            processData: false
        });
    }

    function goto(path) {
        window.location = path;
    }

    function init() {

        var body = $('body');

        fill(true);

        $(':file').change(onFileUploadChange);
        $(':button').click(upload);

        body.on('dragover drop', function(e){
            $('body').css("cursor", "inherit");
            e.preventDefault();
        });
        body.on('dragstart', function(e){
            $('body').css("cursor", "no-drop");
            dragfile = e.originalEvent.dataTransfer.files[0];
        });
    }

    window.chooseFile = chooseFile;
    window.goto = goto;

    init();
});
