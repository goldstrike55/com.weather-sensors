"use strict";

/*
Copyright (c) 2016 Ramón Baas

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*
   Generic weather sensor driver
*/

const utils = require('utils');

const locale = Homey.manager('i18n').getLanguage() == 'nl' ? 'nl' : 'en'; // only Dutch & English supported

var Sensors = new Map(); // all sensors we've found
var Devices = new Map(); // all devices that have been added

const capability = {
	temperature: 'measure_temperature',
	humidity: 'measure_humidity',
	pressure: 'measure_pressure',
	rainrate: 'measure_rain',
	raintotal: 'meter_rain',
	direction: 'measure_wind_angle',
	currentspeed: 'measure_gust_strength',
	averagespeed: 'measure_wind_strength',
	lowbattery: 'alarm_battery'
}

const genericType = {
	R: { en: 'Rain gauge', nl: 'Regenmeter' },
	TH: { en: 'Temperature/humidity', nl: 'Temperatuur/vochtigheid' },
	THB: { en: 'Weather station', nl: 'Weerstation' },
	UV: { en: 'Ultra Violet' },
	W: { en: 'Anemometer', nl: 'Windmeter' }
}

// Update the sensor data
function update(signal) {
	let result = signal.getResult();
	if (typeof result !== 'string' && result != null) {
		let when = result.lastupdate.toString();
		let did = result.protocol + ':' + result.id + ':' + (result.channel || 0);
		if (Sensors.get(did) == null) {
			Sensors.set(did, { raw: { data: {} } });
			signal.debug('Found a new sensor. Total found is now', Sensors.size);
		}
		let current = Sensors.get(did).raw;
		let device = Devices.get(did);
		// Check if a value has changed
		let newdata = false;
		let newvalue = JSON.parse(JSON.stringify(result));
		newvalue.data = current.data;
		for (let c in result.data) {
			if (result.data[c] !== newvalue.data[c]) {
				newdata = true;
				newvalue.data[c] = result.data[c];
				let cap = capability[c];
				if (device != null && cap != null) {
					device.driver.realtime(device.device_data, cap, newvalue.data[c], function(err, success) {
						signal.debug('Real-time', cap, 'update', (err ? err : 'OK'));
					});
				}
			}
		}
		signal.debug('Sensor value has changed:', newdata);
		
		// Add additional data
		newvalue.count = (current.count || 0) + 1;
		newvalue.newdata = newdata;
		// Update settings
		if (device != null) {
			if (!device.available) {
				device.driver.setAvailable(device.device_data);
				device.available = true;
				Devices.set(did, device);
			}
			device.driver.setSettings(device.device_data, { update: when }, function(err, result){
				if (err) { signal.debug('setSettings error:', err); }
			});
		}
		// Update the sensor log
		let display = {
			protocol: signal.getName(),
			type: genericType[newvalue.type][locale] || genericType[newvalue.type].en,
			name: newvalue.name,
			channel: (newvalue.channel ? newvalue.channel.toString() : '-'),
			id: newvalue.id,
			update: when,
			data: newvalue.data,
			paired: device != null
		}
		Sensors.set(did, { raw: newvalue, display: display });
		//signal.debug(Sensors);
		// Send an event to the front-end as well for the app settings page
		Homey.manager('api').realtime('sensor_update', Array.from(Sensors.values()).map(x => x.display));
	}
}

// getSensors: return a list of sensors of type <x>
function getSensors(type) {
	var list = [];
	for (let i of Sensors.keys()) {
		let val = Sensors.get(i);
		if (type != null && val.raw.type == type) {
			list.push({ 
				name: val.raw.name || (type + ' ' + val.raw.id),
				data: {	id: i, type: type },
				settings: {
					protocol: val.display.protocol,
					type: val.raw.name || val.display.type,
					channel: val.display.channel || 0,
					id: val.raw.id,
					update: val.raw.lastupdate.toLocaleString(locale)
				}
			});
		}
	}
	return list;
}

// addSensorDevice
function addSensorDevice(driver, device_data, name) {
	let sensor = Sensors.get(device_data.id);
	Devices.set(device_data.id, {
		driver: driver,
		device_data: device_data,
		name: name,
		available: sensor != null
	})
	if (sensor != null) {
		sensor.display.paired = true;
		Sensors.set(device_data.id, sensor);
	} else {
		driver.setUnavailable(device_data, __('error.no_data'));
	}
}

// deleteSensorDevice
function deleteSensorDevice(device_data) {
	Devices.delete(device_data.id);
	let sensor = Sensors.get(device_data.id);
	if (sensor != null) {
		sensor.display.paired = false;
		Sensors.set(device_data.id, sensor);
	}	
}

// updateDeviceName
function updateDeviceName(device_data, new_name) {
	let dev = Devices.get(device_data.id);
	dev.name = new_name;
	Devices.set(device_data.id, dev);
}

// getSensorValue
function getSensorValue(what, id) {
	let val = Sensors.get(id);
	if (val != null) {
		val = val.raw.data[what];
	}
	return val;
}

// Create a driver for a specific sensor type
function createDriver(driver) {
	var self = {

		init: function(devices_data, callback) {
			devices_data.forEach(function(device_data) {
				// Get the Homey name of the device
				self.getName(device_data, function(err, name) {
					addSensorDevice(self, device_data, name);
					// we're ready
				});
			});
			callback();
		},
		
		capabilities: {
			measure_temperature: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('temperature', device_data.id);
							callback(null, val);
						}
				}
			},
			measure_humidity: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('humidity', device_data.id);
							callback(null, val);
						}
				}
			},
			measure_pressure: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('pressure', device_data.id);
							callback(null, val);
						}
				}
			},
			measure_rain: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('rainrate', device_data.id);
							callback(null, val);
						}
				}
			},
			meter_rain: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('raintotal', device_data.id);
							callback(null, val);
						}
				}
			},
			measure_wind_angle: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('direction', device_data.id);
							callback(null, val);
						}
				}
			},
			measure_gust_strength: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('currentspeed', device_data.id);
							callback(null, val);
						}
				}
			},
			measure_wind_strength: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('averagespeed', device_data.id);
							callback(null, val);
						}
				}
			},
			alarm_battery: {
				get: function(device_data, callback) {
						if (typeof callback == 'function') {
							var val = getSensorValue('lowbattery', device_data.id);
							callback(null, val);
						}
				}
			}
		},

		added: function(device_data, callback) {
			// Update driver administration when a device is added
			self.getName(device_data, function(err, name) {
				addSensorDevice(self, device_data, name);
			});

			callback();
		},
		
		renamed: function(device_data, new_name) {
			updateDeviceName(device_data, new_name);
		},
		
		deleted: function(device_data) {
			// Run when the user has deleted the device from Homey
			deleteSensorDevice(device_data);
		},
		
		pair: function(socket) {
			utils.debug('Sensor', driver, 'pairing has started...');

			// This method is run when Homey.emit('list_devices') is run on the front-end
			// which happens when you use the template `list_devices`
			socket.on('list_devices', function(data, callback) {
				var devices = getSensors(driver);
				utils.debug(driver, devices)
				// err, result style
				callback(null, devices);
			});
		}
	}
	return self;
}

module.exports = { 
	createDriver: createDriver,
	getSensors: () => Array.from(Sensors.values()).map(x => x.display),
	update: update
};