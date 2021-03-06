/**
 *  nodeodm-proxy - A reverse proxy, load balancer and task tracker for NodeODM
 *  Copyright (C) 2018-present MasseranoLabs LLC
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const logger = require('./libs/logger');
const net = require('net');
const package_info = require('./package_info');
const nodes = require('./libs/nodes');
const routetable = require('./libs/routetable');

module.exports = {
    create: function(options){
        logger.info("Starting admin CLI on " + options.port);

        if (!options.password){
            logger.warn(`No admin CLI password specified, make sure port ${options.port} is secured`);
        }

        // Start a TCP Server
        net.createServer(function (socket) {
            let loggedIn = false;
            const printCaret = () => {
                if (loggedIn) socket.write("#> ");
                else socket.write("$> ");
            };
            const ok = () => {
                socket.write("OK\r\n");
            };
            const invalid = () => {
                socket.write("INVALID\r\n");
            };
            const fail = () => {
                socket.write("FAIL\r\n");
            };
            const reply = (flag) => {
                if (flag) ok();
                else fail();
            };
            const printNode = (socket, i, node) => {
                socket.write(`${(i + 1)}) ${node.toString()} ${node.isOnline() ? '[online]' : '[offline]'} [${node.getTaskQueueCount()}/${node.getMaxParallelTasks()}] <version ${node.getVersion()}>\r\n`);
            };


            // Identify this client
            socket.name = socket.remoteAddress + ":" + socket.remotePort;

            // Send a nice welcome message and announce
            socket.write("Welcome " + socket.name + " " + package_info.name + ":" + package_info.version + "\r\n");
            if (options.password){
                socket.write("LOGIN <LOGIN> to log-in\r\n");
            }else{
                loggedIn = true;
                socket.write("HELP for help\r\n");
            }
            socket.write("QUIT to quit\r\n");

            printCaret();

            // Handle incoming messages from clients.
            socket.on('data', async function (data) {
                const parts = data.toString().split(" ").map(p => p.trim());
                const command = parts[0].toLocaleUpperCase();
                let args = parts.slice(1, parts.length);
                
                if (command === "QUIT"){
                    socket.write("Bye!\r\n");
                    socket.destroy();
                    return;
                }

                if (loggedIn){
                    if (command === "HELP"){
                        socket.write("NODE ADD <hostname> <port> [token] - Add new node\r\n");
                        socket.write("NODE DEL <node number> - Remove a node\r\n");
                        socket.write("NODE INFO <node number> - View JSON info of node\r\n");
                        socket.write("NODE LIST - List nodes\r\n");
                        socket.write("NODE UPDATE - Update all nodes info\r\n");
                        socket.write("NODE BEST <number of images> - Show best node for the number of images\r\n");
                        socket.write("ROUTE INFO <taskId> - Find route information\r\n");
                    }else if (command === "NODE" && args.length > 0){
                        const subcommand = args[0].toLocaleUpperCase();
                        args = args.slice(1, args.length);

                        if (subcommand === "ADD" && args.length >= 2){
                            const [ hostname, port, token ] = args;
                            const node = nodes.add(hostname, port, token);
                            if (node) node.updateInfo();
                            reply(!!node);
                        }else if (subcommand === "DEL" && args.length >= 1){
                            const [ number ] = args;
                            reply(nodes.remove(nodes.nth(number)));
                        }else if (subcommand === "LIST"){
                            nodes.all().forEach((n, i) => {
                                printNode(socket, i, n);
                            });
                            socket.write("\r\n");
                        }else if (subcommand === "UPDATE"){
                            nodes.updateInfo().then(() => {
                                ok(); printCaret();
                            }).catch(() => {
                                fail(); printCaret();
                            });
                            return;
                        }else if (subcommand === "INFO" && args.length >= 1){
                            const [ number ] = args;
                            const node = nodes.nth(number);
                            if (node){
                                socket.write(JSON.stringify(node.getInfo()) + "\r\n");
                            }else invalid();
                        }else if (subcommand === "BEST" && args.length >= 1){
                            const [ numImages ] = args;
                            const node = await nodes.findBestAvailableNode(numImages);
                            if (node){
                                printNode(socket, 0, node);
                            }else{
                                socket.write("No best node available\r\n");
                            }
                        }else{
                            invalid();
                        }
                    }else if (command === "ROUTE" && args.length > 0){
                        const subcommand = args[0].toLocaleUpperCase();
                        args = args.slice(1, args.length);
                        
                        if (subcommand === "INFO" && args.length >= 1){
                            const [ taskId ] = args;
                            const route = await routetable.lookup(taskId);
                            if (route){
                                socket.write(JSON.stringify(route) + "\r\n");
                            }else invalid();
                        }
                    }else{
                        invalid();
                    }
                }else{
                    if (command === "LOGIN" && args[0] === options.password){
                        loggedIn = true;
                        ok();
                        socket.write("HELP for help\r\n");
                    }else{
                        socket.destroy();
                        return;
                    }
                }

                printCaret();
            });
        }).listen(options.port);
    }
};