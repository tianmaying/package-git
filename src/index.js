var settings = require("./settings");
var templateBranch = require("./templates/branch.html");
var templateFile = require("./templates/file.html");

var Q = codebox.require("q");
var _ = codebox.require("hr.utils");
var rpc = codebox.require("core/rpc");
var commands = codebox.require("core/commands");
var dialogs = codebox.require("utils/dialogs");

var cmdBranchSwitch, cmdBranchCreate, cmdBranchDelete, cmdInit, cmdClone, cmdCommit, cmdPush, cmdSync, cmdStatus;

// Toggle commands that need git to be ok
var toggleStatus = function(state) {
    _.invoke([
        cmdBranchSwitch, cmdBranchCreate, cmdCommit, cmdPush, cmdPull, cmdSync,
        cmdStatus, cmdBranchDelete
    ], "set", "enabled", state);

    _.invoke([
        cmdInit, cmdClone
    ], "set", "enabled", !state);
};

// Check git status
var updateStatus = function(p) {
    return (p || rpc.execute("git/status"))
    .then(function(d) {
        toggleStatus(true);
        return d;
    }, function(err) {
        toggleStatus(false);
        return Q.reject(err);
    })
};

// Handle http auth
var handleHttpAuth = function(method) {
    return Q(method())
    .fail(function(err) {
        if (err.code == 401) {
            // Fields for https auth
            var fields = {
                username: {
                    type: "string",
                    description: "Username"
                },
                password: {
                    type: "string",
                    description: "Password",
                    password: true
                }
            };

            // Passphrase for ssh
            if (err.message.toLowerCase().indexOf("authentication") < 0) {
                fields = {
                    passphrase: {
                        type: "string",
                        label: "Passphrase"
                    }
                };
            }

            return dialogs.schema({
                title: "需要验证:",
                properties: fields
            })
            .then(method);
        } else {
            return Q.reject(err);
        }
    })
};

///// Branches

var selectBranch = function() {
    return codebox.statusbar.loading(
        rpc.execute("git/branches"),
        {
            prefix: "Listing branches"
        }
    )
    .fail(dialogs.error)
    .then(function(branches) {
        return dialogs.list(branches, {
            template: templateBranch
        })
    });
};

cmdBranchSwitch = commands.register({
    id: "git.branch.change",
    title: "Git: 切换分支",
    run: function(args, context) {
        return selectBranch()
        .then(function(branch) {
            return codebox.statusbar.loading(
                rpc.execute("git/checkout", {
                    'ref': branch.get("name")
                }),
                {
                    prefix: "Checkout '"+branch.get("name")+"'"
                }
            ).fail(dialogs.error);
        });
    }
});

cmdBranchCreate = commands.register({
    id: "git.branch.create",
    title: "Git: 创建分支",
    run: function(args, context) {
        return dialogs.prompt("Create a branch")
        .then(function(branch) {
            return codebox.statusbar.loading(
                rpc.execute("git/branch_create", {
                    'name': branch
                }),
                {
                    prefix: "Creating branch '"+branch+"'"
                }
            ).fail(dialogs.error);
        });
    }
});

cmdBranchDelete = commands.register({
    id: "git.branch.delete",
    title: "Git: 删除分支",
    run: function(args, context) {
        return selectBranch()
        .then(function(branch) {
            return codebox.statusbar.loading(
                rpc.execute("git/branch_delete", {
                    'name': branch.get("name")
                }),
                {
                    prefix: "Removing '"+branch.get("name")+"'"
                }
            ).fail(dialogs.error);
        });
    }
});

///// Init/Clone

cmdInit = commands.register({
    id: "git.init",
    title: "Git: 初始化(Init)",
    run: function(args, context) {
        return updateStatus(rpc.execute("git/init"));
    }
});

cmdClone = commands.register({
    id: "git.clone",
    title: "Git: Clone仓库",
    run: function(args, context) {
        return dialogs.prompt("Clone repository:")
        .then(function(url) {
            return codebox.statusbar.loading(
                handleHttpAuth(function(creds) {
                    return updateStatus(rpc.execute("git/clone", {
                        'url': url,
                        'auth': creds || {}
                    }));
                }),
                {
                    prefix: "Cloning repository"
                }
            ).fail(dialogs.error);
        });
    }
});

///// Commit

cmdCommit = commands.register({
    id: "git.commit",
    title: "Git: 提交(Commit)",
    run: function(args, context) {
        return dialogs.schema({
            title: "Commit Changes:",
            properties: {
                message: {
                    description: "Message:",
                    type: "string"
                },
                files: {
                    description: "Files (paths separeated by coma, * for all changes)",
                    type: "string",
                    default: "*"
                }
            }
        }, args)
        .then(function(infos) {
            infos.name = settings.data.get("name");
            infos.email = settings.data.get("email");

            if (infos.files == "*") {
                infos.files = [];
            } else {
                infos.files = infos.files.split(",");
            }


            return codebox.statusbar.loading(
                rpc.execute("git/commit", infos),
                {
                    prefix: "Commiting"
                }
            ).fail(dialogs.error);
        });
    }
});

///// Status

cmdStatus = commands.register({
    id: "git.status",
    title: "Git: 状态(Status)",
    run: function() {
        return updateStatus()
        .fail(dialogs.error)
        .then(function(status) {
            var files = _.map(status.files, function(st, fileName) {
                return {
                    'status': st,
                    'filename': fileName
                }
            });

            if (files.length == 0) return dialogs.alert("nothing to commit, working directory clean");

            return dialogs.list(files, {
                template: templateFile
            })
            .then(function(file) {
                return cmdCommit.run({
                    files: file.get("filename")
                });
            });
        });
    }
});

///// Remote sync

cmdPush = commands.register({
    id: "git.push",
    title: "Git: 推送(Push)",
    run: function() {
        return codebox.statusbar.loading(
            handleHttpAuth(function(creds) {
                return rpc.execute("git/push");
            }),
            {
                prefix: "Pushing"
            }
        ).fail(dialogs.error);
    }
});

cmdPull = commands.register({
    id: "git.pull",
    title: "Git: 拉取(Pull)",
    run: function() {
        return codebox.statusbar.loading(
            handleHttpAuth(function(creds) {
                return rpc.execute("git/pull");
            }),
            {
                prefix: "Pulling"
            }
        ).fail(dialogs.error);
    }
});

cmdSync = commands.register({
    id: "git.sync",
    title: "Git: 同步(Sync)",
    run: function() {
        return codebox.statusbar.loading(
            handleHttpAuth(function(creds) {
                return rpc.execute("git/sync");
            }),
            {
                prefix: "Syncing (pull & push)"
            }
        ).fail(dialogs.error);
    }
});

codebox.menubar.createMenu({
    id: "git",
    caption: "Git仓库",
    items: [
        {
            caption: "初始化(Init)仓库",
            command: "git.init"
        },
        {
            caption: "克隆(Clone)仓库",
            command: "git.clone"
        },
        { type: "separator" },
        {
            caption: "提交(Commit)代码",
            command: "git.commit"
        },
        {
            caption: "状态(Status)",
            command: "git.status"
        },
        { type: "separator" },
        {
            caption: "推送(Push)",
            command: "git.push"
        },
        {
            caption: "拉取(Pull)",
            command: "git.pull"
        },
        { type: "separator" },
        {
            caption: "切换分支...",
            command: "git.branch.change"
        },
        {
            caption: "创建分支",
            command: "git.branch.create"
        },
        {
            caption: "删除分支",
            command: "git.branch.delete"
        }
    ]
});

updateStatus();
