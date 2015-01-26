{# NOTE: kendo editor requires jquery, underscore and q; load these libraries only if they havent been loaded before #}

{% if not jquery_is_loaded  %}
<script src="/common/js/jquery.js"></script>
{% endif %}

{% if not underscore_is_loaded  %}
<script src="/common/js/underscore.js"></script>
{% endif %}

{% if not q_is_loaded  %}
<script src="/common/js/q.js"></script>
{% endif %}


<script src="/common/js/kendo/kendo.core.min.js"></script>
<script src="/common/js/kendo/kendo.web.min.js"></script>
<script src="/common/js/kendo/kendo.editor.min.js"></script>

<script src="/common/js/kendo_editor.js"></script> 
