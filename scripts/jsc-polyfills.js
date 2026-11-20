/* Полифилы веб-API для JavaScriptCore.

   JSC — чистый движок ECMAScript: в нём есть Math, Date, JSON, RegExp, типизированные
   массивы и decodeURIComponent, но нет ничего из веб-платформы. Electron всё это даёт
   сам, поэтому Windows-версии файл не нужен — он попадает только в iOS-бандл.

   Реализовано ровно то, что использует src/shared, и не больше:
     atob            — внутри b64decode
     TextDecoder     — там же, только .decode(Uint8Array) в utf-8
     URLSearchParams — разбор ссылок, только конструктор от строки, get и set

   Каждый полифил ставится, лишь если хост своего не дал: тогда тот же бандл
   исполняется и в Node при сверке эталонов, используя родные реализации. */

;(function (root) {
  'use strict'

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  if (typeof root.atob !== 'function') {
    root.atob = function atob(input) {
      var s = String(input).replace(/[\t\n\f\r ]/g, '')
      if (s.length % 4 === 0) s = s.replace(/==?$/, '')
      if (s.length % 4 === 1 || /[^+/0-9A-Za-z]/.test(s)) throw new Error('atob: строка не base64')
      var out = ''
      var buf = 0
      var bits = 0
      for (var i = 0; i < s.length; i++) {
        buf = (buf << 6) | B64.indexOf(s.charAt(i))
        bits += 6
        if (bits >= 8) {
          bits -= 8
          out += String.fromCharCode((buf >> bits) & 0xff)
        }
      }
      return out
    }
  }

  if (typeof root.TextDecoder !== 'function') {
    /* Декодер utf-8. Некорректные последовательности заменяются на U+FFFD —
       так же ведёт себя штатный TextDecoder без fatal:true. */
    var TextDecoderShim = function TextDecoder(label) {
      var enc = String(label == null ? 'utf-8' : label).toLowerCase()
      if (enc !== 'utf-8' && enc !== 'utf8' && enc !== 'unicode-1-1-utf-8') {
        throw new RangeError('TextDecoder: поддерживается только utf-8, запрошено ' + label)
      }
    }

    TextDecoderShim.prototype.decode = function decode(input) {
      if (input == null) return ''
      var b = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input)
      var out = ''
      var i = 0
      while (i < b.length) {
        var c = b[i++]
        var need// сколько байт продолжения ожидается
        var cp // накопленная кодовая точка
        if (c < 0x80) {
          out += String.fromCharCode(c)
          continue
        } else if (c >= 0xc2 && c <= 0xdf) {
          need = 1
          cp = c & 0x1f
        } else if (c >= 0xe0 && c <= 0xef) {
          need = 2
          cp = c & 0x0f
        } else if (c >= 0xf0 && c <= 0xf4) {
          need = 3
          cp = c & 0x07
        } else {
          out += '�'
          continue
        }

        if (i + need > b.length) {
          out += '�'
          break
        }

        var ok = true
        for (var k = 0; k < need; k++) {
          var cc = b[i + k]
          if ((cc & 0xc0) !== 0x80) {
            ok = false
            break
          }
          cp = (cp << 6) | (cc & 0x3f)
        }
        if (!ok) {
          out += '�'
          continue
        }
        i += need

        // Отсекаем избыточные кодировки, суррогаты и выход за предел Unicode
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (need === 2 && cp < 0x800) || (need === 3 && cp < 0x10000)) {
          out += '�'
        } else if (cp > 0xffff) {
          cp -= 0x10000
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        } else {
          out += String.fromCharCode(cp)
        }
      }
      return out
    }

    root.TextDecoder = TextDecoderShim
  }

  if (typeof root.URLSearchParams !== 'function') {
    /* В ссылках попадаются кривые проценты (%zz) — штатный URLSearchParams их
       не роняет, поэтому и здесь декодирование терпимое. */
    var dec = function (s) {
      try {
        return decodeURIComponent(String(s).replace(/\+/g, ' '))
      } catch (e) {
        return String(s)
      }
    }

    var URLSearchParamsShim = function URLSearchParams(init) {
      this._p = []
      if (typeof init === 'string' && init) {
        var parts = init.replace(/^\?/, '').split('&')
        for (var i = 0; i < parts.length; i++) {
          if (!parts[i]) continue
          var eq = parts[i].indexOf('=')
          var k = eq < 0 ? parts[i] : parts[i].slice(0, eq)
          var v = eq < 0 ? '' : parts[i].slice(eq + 1)
          this._p.push([dec(k), dec(v)])
        }
      }
    }

    URLSearchParamsShim.prototype.get = function get(name) {
      var n = String(name)
      for (var i = 0; i < this._p.length; i++) if (this._p[i][0] === n) return this._p[i][1]
      return null
    }

    URLSearchParamsShim.prototype.set = function set(name, value) {
      var n = String(name)
      var v = String(value)
      for (var i = 0; i < this._p.length; i++) {
        if (this._p[i][0] === n) {
          this._p[i][1] = v
          // остальные вхождения с тем же именем штатный set удаляет
          for (var j = this._p.length - 1; j > i; j--) if (this._p[j][0] === n) this._p.splice(j, 1)
          return
        }
      }
      this._p.push([n, v])
    }

    root.URLSearchParams = URLSearchParamsShim
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
