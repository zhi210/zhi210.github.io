// 汉堡菜单切换（移动端）
(function() {
  var toggle = document.getElementById('hamb-toggle');
  var menu   = document.getElementById('side-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function() {
      menu.checked = !menu.checked;
    });
  }
})();
